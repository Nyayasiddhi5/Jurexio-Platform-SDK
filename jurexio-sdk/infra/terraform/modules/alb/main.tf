# =============================================================================
# ALB module — single Application Load Balancer with one HTTPS:443 listener
# (ACM-attached) that forwards to the EC2 host's :80 (where Caddy host-routes
# by `Host` header).  The :80 listener redirects to :443.  WAF is attached
# from the envs (so we can swap web ACLs per env).
# =============================================================================

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "name"               { type = string }
variable "vpc_id"             { type = string }
variable "public_subnet_ids"  { type = list(string) }
variable "certificate_arn"    { type = string }
variable "tags"               {
  type = map(string)
  default = {}
}
# Note: target attachment is performed by the calling env (avoids a cycle:
# alb -> ec2_host_sg -> alb_sg).

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "ALB ingress for ${var.name}"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-alb-sg" })
}

resource "aws_lb" "this" {
  name                       = var.name
  load_balancer_type         = "application"
  subnets                    = var.public_subnet_ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true
  idle_timeout               = 600

  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    prefix  = var.name
    enabled = true
  }

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_s3_bucket" "alb_logs" {
  bucket        = "${var.name}-access-logs"
  force_destroy = false
  tags          = var.tags
}

# ALB requires the official AWS account for ap-south-1 (718504428378) to be
# allowed PutObject on the access-logs bucket.  Region-specific list:
# https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
resource "aws_s3_bucket_policy" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::718504428378:root" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.alb_logs.arn}/*"
    }]
  })
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration { days = 90 }
  }
}

# Single TG that points at the EC2 host on :80; Caddy does the host routing.
resource "aws_lb_target_group" "edge" {
  name        = "${var.name}-edge"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    path                = "/health"
    matcher             = "200"
  }

  deregistration_delay = 30
  tags                 = merge(var.tags, { Name = "${var.name}-edge-tg" })
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.edge.arn
  }
}

output "alb_arn"        { value = aws_lb.this.arn }
output "alb_arn_suffix" { value = aws_lb.this.arn_suffix }
output "alb_dns"        { value = aws_lb.this.dns_name }
output "alb_zone_id"    { value = aws_lb.this.zone_id }
output "alb_sg_id"      { value = aws_security_group.alb.id }
output "tg_arn"         { value = aws_lb_target_group.edge.arn }
