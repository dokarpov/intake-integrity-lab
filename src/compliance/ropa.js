import { sha256 } from './crypto.js';

export function validateProcessingActivity(activity) {
  const errors = [];
  if (!activity?.activityId) errors.push('activity_id');
  if (!activity?.controller?.name) errors.push('controller_name');
  if (!activity?.purposes?.length) errors.push('purposes');
  if (!activity?.dataSubjectCategories?.length) errors.push('data_subject_categories');
  if (!activity?.personalDataCategories?.length) errors.push('personal_data_categories');
  if (!activity?.retention?.length) errors.push('retention');
  if (!activity?.securityMeasures?.length) errors.push('security_measures');
  return { ok: errors.length === 0, errors };
}

export function processingActivitySnapshot(activity) {
  const validation = validateProcessingActivity(activity);
  if (!validation.ok) throw new Error(`invalid_processing_activity:${validation.errors.join(',')}`);
  return {
    activityId: activity.activityId,
    version: activity.version || '1',
    digest: `sha256:${sha256(activity)}`
  };
}
