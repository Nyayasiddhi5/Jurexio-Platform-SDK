# =============================================================================
# ec2_host — single application EC2 host that runs the docker-compose stack.
# Sized for ~$60/mo with t3.large; bumps to m5.large at higher load.
# =============================================================================

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "name"              { type = string }
variable "vpc_id"            { type = string }
variable "subnet_id"         { type = string }
variable "instance_type"     {
  type = string
  default = "t3.large"
}
variable "ssh_key_name"      {
  type = string
  description = "Name of the EC2 keypair created via the AWS console (one-time)"
}
variable "alb_sg_id"         { type = string }
# SSH ingress is OFF by default. Operators reach the host via SSM
# Session Manager (no inbound :22 needed). Setting `extra_ingress_cidrs` to
# any non-empty list opens :22 to those CIDRs and is intentionally a
# documented escape hatch — see NYV-IAM-GAPS.md → "SSM-only ingress".
variable "extra_ingress_cidrs" {
  type = list(string)
  default = []
}
variable "secrets_arn_pattern"{
  type = string
  description = "Used by the instance role to read SM secrets"
}
variable "log_group_arn_pattern" {
  type = string
  default = "arn:aws:logs:*:*:log-group:/aws/nyayavigya/*"
}
variable "ecr_repo_arns"     {
  type = list(string)
  default = []
}
variable "tags"              {
  type = map(string)
  default = {}
}
# Latest Ubuntu 24.04 LTS amd64 from Canonical
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]   # Canonical
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

resource "aws_security_group" "host" {
  name        = "${var.name}-host"
  description = "EC2 host ${var.name}"
  vpc_id      = var.vpc_id

  # Only the ALB can reach the host on :80 (Caddy)
  ingress {
    description     = "Caddy from ALB"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [var.alb_sg_id]
  }

  # SSH from operator CIDRs
  dynamic "ingress" {
    for_each = var.extra_ingress_cidrs
    content {
      description = "SSH from ${ingress.value}"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-host-sg" })
}

# IAM role for the instance: read scoped secrets + push CloudWatch logs +
# pull from ECR.
resource "aws_iam_role" "host" {
  name = "${var.name}-host"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "host" {
  name = "${var.name}-host"
  role = aws_iam_role.host.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
        Resource = var.secrets_arn_pattern
      },
      {
        Sid      = "WriteLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
        Resource = var.log_group_arn_pattern
      },
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "EcrPullScoped"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = length(var.ecr_repo_arns) > 0 ? var.ecr_repo_arns : ["*"]
      },
      {
        Sid      = "SsmCore"
        Effect   = "Allow"
        Action   = ["ssm:UpdateInstanceInformation", "ssm:ListInstanceAssociations", "ssmmessages:*", "ec2messages:*"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "host" {
  name = "${var.name}-host"
  role = aws_iam_role.host.name
}

# Cloud-init installs docker, awscli, ssm-agent, then idles waiting for
# scripts/bootstrap-fresh-ec2.sh to be run from the operator.
locals {
  user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
      ca-certificates curl gnupg lsb-release jq awscli rsync git unzip
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    usermod -aG docker ubuntu
    mkdir -p /opt/nyayavigya/repo /opt/nyayavigya/releases /opt/nyayavigya/incoming /opt/nyayavigya/logs
    chown -R ubuntu:ubuntu /opt/nyayavigya

    # Snap-installed amazon-ssm-agent comes pre-installed on Ubuntu 24.04 AMI;
    # ensure it's running.
    snap services amazon-ssm-agent || true
  EOT
}

resource "aws_instance" "this" {
  ami                  = data.aws_ami.ubuntu.id
  instance_type        = var.instance_type
  subnet_id            = var.subnet_id
  vpc_security_group_ids = [aws_security_group.host.id]
  iam_instance_profile = aws_iam_instance_profile.host.name
  key_name             = var.ssh_key_name
  user_data            = local.user_data
  user_data_replace_on_change = false

  metadata_options {
    http_tokens   = "required"      # IMDSv2 only
    http_endpoint = "enabled"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 80
    encrypted             = true
    delete_on_termination = false
  }

  monitoring = true

  tags = merge(var.tags, { Name = var.name })

  lifecycle {
    ignore_changes = [ami, user_data]   # avoid full re-create on AMI rotation
  }
}

resource "aws_eip" "this" {
  instance = aws_instance.this.id
  domain   = "vpc"
  tags     = merge(var.tags, { Name = "${var.name}-eip" })
}

output "instance_id" { value = aws_instance.this.id }
output "private_ip"  { value = aws_instance.this.private_ip }
output "public_ip"   { value = aws_eip.this.public_ip }
output "host_sg_id"  { value = aws_security_group.host.id }
output "iam_role_arn"{ value = aws_iam_role.host.arn }
