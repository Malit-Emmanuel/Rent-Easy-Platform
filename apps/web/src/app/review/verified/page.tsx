'use client';
import { useI18n } from '@/components/I18n';
import PageHead from '@/components/PageHead';
import ReviewTabs from '@/components/ReviewTabs';
import VerifiedProperties from '@/components/VerifiedProperties';

export default function VerifiedPage() {
  const { t } = useI18n();
  return (<><PageHead eyebrow={t('appName')} title={t('rvTitle')} /><ReviewTabs /><VerifiedProperties /></>);
}
