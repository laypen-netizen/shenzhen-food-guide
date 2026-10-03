import type {Shop} from './schema.ts';

export function shopPhotoLabel(photo:Shop['photos'][number]):string {
  return photo.view==='sign-detail' ? '实景招牌':'门头实拍';
}
