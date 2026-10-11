output "worm_bucket" { value = aws_s3_bucket.worm.bucket }
output "archive_kms_key_arn" { value = aws_kms_key.archive.arn }
output "checkpoint_signing_key_arn" { value = aws_kms_key.checkpoint_signing.arn }
output "subject_hmac_key_arn" { value = aws_kms_key.subject_hmac.arn }
output "control_plane_cloudtrail_arn" { value = aws_cloudtrail.control_plane.arn }
