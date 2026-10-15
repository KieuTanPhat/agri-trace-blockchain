import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

/** Admission stays closed until the operator explicitly enables this release. */
@Injectable()
export class EnterpriseOnboardingGuard implements CanActivate {
  canActivate() {
    if (process.env.ENTERPRISE_ONBOARDING_ENABLED !== 'true')
      throw new ServiceUnavailableException(
        'Đăng ký doanh nghiệp đang được chuẩn bị; vui lòng thử lại sau',
      );
    return true;
  }
}
