import PageHeader from '@/components/common/PageHeader';
import { FeatureUnavailable } from '@/components/common/StateViews';

interface Props {
  title: string;
  subtitle: string;
  endpoints: string[];
}

/** Stage-1 stand-in: honest "not connected" page. Replaced by the real feature in its stage. */
export default function PlannedModule({ title, subtitle, endpoints }: Props) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <FeatureUnavailable title={`${title} is not connected yet`} endpoints={endpoints} />
    </>
  );
}
