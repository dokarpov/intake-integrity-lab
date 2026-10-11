provider "aws" { region = var.region }

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

resource "aws_kms_key" "archive" {
  description         = "Envelope encryption key for immutable compliance-ledger archives"
  enable_key_rotation = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([{
      Sid = "AccountAdministration"
      Effect = "Allow"
      Principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action = "kms:*"
      Resource = "*"
    }], length(var.application_principal_arns) == 0 ? [] : [{
      Sid = "ApplicationEnvelopeEncryption"
      Effect = "Allow"
      Principal = { AWS = var.application_principal_arns }
      Action = ["kms:GenerateDataKey", "kms:Decrypt", "kms:DescribeKey"]
      Resource = "*"
    }], [{
      Sid = "CloudTrailEncryption"
      Effect = "Allow"
      Principal = { Service = "cloudtrail.amazonaws.com" }
      Action = ["kms:GenerateDataKey*", "kms:DescribeKey"]
      Resource = "*"
      Condition = { StringEquals = { "aws:SourceArn" = local.control_trail_arn } }
    }])
  })
  tags = var.tags
}
resource "aws_kms_alias" "archive" { name = "alias/${var.name}-archive" target_key_id = aws_kms_key.archive.key_id }

resource "aws_kms_key" "checkpoint_signing" {
  description              = "HSM-backed asymmetric key for audit-ledger checkpoint signatures"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_NIST_P256"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([{
      Sid="AccountAdministration", Effect="Allow", Principal={AWS="arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"}, Action="kms:*", Resource="*"
    }], length(var.application_principal_arns)==0 ? [] : [{
      Sid="ApplicationCheckpointSigning", Effect="Allow", Principal={AWS=var.application_principal_arns}, Action=["kms:Sign","kms:Verify","kms:GetPublicKey","kms:DescribeKey"], Resource="*"
    }])
  })
  tags = var.tags
}
resource "aws_kms_alias" "checkpoint_signing" { name = "alias/${var.name}-checkpoint-signing" target_key_id = aws_kms_key.checkpoint_signing.key_id }

resource "aws_kms_key" "subject_hmac" {
  description              = "HSM-backed HMAC key for pseudonymous data-subject references"
  key_usage                = "GENERATE_VERIFY_MAC"
  customer_master_key_spec = "HMAC_256"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([{
      Sid="AccountAdministration", Effect="Allow", Principal={AWS="arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"}, Action="kms:*", Resource="*"
    }], length(var.application_principal_arns)==0 ? [] : [{
      Sid="ApplicationSubjectMac", Effect="Allow", Principal={AWS=var.application_principal_arns}, Action=["kms:GenerateMac","kms:VerifyMac","kms:DescribeKey"], Resource="*"
    }])
  })
  tags = var.tags
}
resource "aws_kms_alias" "subject_hmac" { name = "alias/${var.name}-subject-hmac" target_key_id = aws_kms_key.subject_hmac.key_id }

resource "aws_s3_bucket" "worm" {
  bucket_prefix       = "${var.name}-worm-"
  object_lock_enabled = true
  force_destroy        = false
  tags                 = var.tags
}

resource "aws_s3_bucket_versioning" "worm" {
  bucket = aws_s3_bucket.worm.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_object_lock_configuration" "worm" {
  bucket = aws_s3_bucket.worm.id
  depends_on = [aws_s3_bucket_versioning.worm]
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.retention_days
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "worm" {
  bucket = aws_s3_bucket.worm.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.archive.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "worm" {
  bucket = aws_s3_bucket.worm.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "worm" {
  bucket = aws_s3_bucket.worm.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid = "DenyInsecureTransport"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:*"
        Resource = [aws_s3_bucket.worm.arn, "${aws_s3_bucket.worm.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid = "CloudTrailAclCheck"
        Effect = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action = "s3:GetBucketAcl"
        Resource = aws_s3_bucket.worm.arn
        Condition = { StringEquals = { "aws:SourceArn" = local.control_trail_arn } }
      },
      {
        Sid = "CloudTrailWrite"
        Effect = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action = "s3:PutObject"
        Resource = "${aws_s3_bucket.worm.arn}/cloudtrail/AWSLogs/${data.aws_caller_identity.current.account_id}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl" = "bucket-owner-full-control",
            "aws:SourceArn" = local.control_trail_arn
          }
        }
      }
    ], length(var.application_principal_arns) == 0 ? [] : [
      {
        Sid = "AllowApplicationAppendAndReadOwnArchives"
        Effect = "Allow"
        Principal = { AWS = var.application_principal_arns }
        Action = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectRetention", "s3:GetObjectLegalHold", "s3:GetBucketVersioning", "s3:GetBucketObjectLockConfiguration"]
        Resource = [aws_s3_bucket.worm.arn, "${aws_s3_bucket.worm.arn}/*"]
      }
    ], length(var.control_admin_principal_arns) == 0 ? [] : [
      {
        Sid = "AllowControlledRetentionAdministration"
        Effect = "Allow"
        Principal = { AWS = var.control_admin_principal_arns }
        Action = ["s3:PutObjectRetention", "s3:PutObjectLegalHold", "s3:GetObjectRetention", "s3:GetObjectLegalHold"]
        Resource = ["${aws_s3_bucket.worm.arn}/*"]
      }
    ])
  })
}
