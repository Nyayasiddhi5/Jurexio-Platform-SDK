variable "aws_region"       {
  type = string
  default = "ap-south-1"
}
variable "aws_account_id"   {
  type = string
  default = "789925699169"
}
variable "domain"           {
  type = string
  default = "nyayasiddhi.online"
}
variable "ssh_key_name"     {
  type = string
  default = "nysdev"
}
variable "operator_ssh_cidrs" {
  type    = list(string)
  default = []
}
variable "alarm_email" {
  type    = string
  default = null
}
