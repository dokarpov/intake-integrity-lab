variable "region" { type = string }
variable "name" { type = string default = "intake-integrity-ledger" }
variable "retention_days" { type = number default = 2555 }
variable "application_principal_arns" { type = list(string) default = [] }
variable "tags" { type = map(string) default = {} }

variable "control_admin_principal_arns" { type = list(string) default = [] }
