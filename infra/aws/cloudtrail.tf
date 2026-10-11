locals {
  control_trail_name = "${var.name}-control-plane"
  control_trail_arn  = "arn:${data.aws_partition.current.partition}:cloudtrail:${var.region}:${data.aws_caller_identity.current.account_id}:trail/${local.control_trail_name}"
}

resource "aws_cloudtrail" "control_plane" {
  name                          = local.control_trail_name
  s3_bucket_name                = aws_s3_bucket.worm.id
  s3_key_prefix                 = "cloudtrail"
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true
  kms_key_id                    = aws_kms_key.archive.arn

  event_selector {
    read_write_type           = "All"
    include_management_events = true
    data_resource {
      type   = "AWS::S3::Object"
      values = ["${aws_s3_bucket.worm.arn}/"]
    }
  }

  depends_on = [aws_s3_bucket_policy.worm]
  tags       = var.tags
}
