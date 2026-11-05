import {
  Archive,
  CheckCircle2,
  Circle,
  Eye,
  FileEdit,
  Globe,
  Lock,
  PlayCircle,
} from 'lucide-react';
import type { CourseStatus, EnrollmentStatus, LessonStatus } from '@cadence/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';

/**
 * Every status chip in the app.
 *
 * The design's third principle is explicit: "Status = icon + word + colour.
 * Never colour alone." So this is the only component that renders a status,
 * and it always renders all three. Nothing anywhere colours text by status
 * without the icon and the word beside it.
 */

type StatusSpec = {
  label: string;
  variant: NonNullable<BadgeProps['variant']>;
  Icon: typeof Circle;
};

const LESSON_SPECS: Record<LessonStatus, StatusSpec> = {
  NOT_STARTED: { label: 'Not started', variant: 'secondary', Icon: Circle },
  IN_PROGRESS: { label: 'In progress', variant: 'warning', Icon: PlayCircle },
  COMPLETED: { label: 'Completed', variant: 'success', Icon: CheckCircle2 },
  LOCKED: { label: 'Locked', variant: 'outline', Icon: Lock },
};

const COURSE_SPECS: Record<CourseStatus, StatusSpec> = {
  DRAFT: { label: 'Draft', variant: 'secondary', Icon: FileEdit },
  PUBLISHED: { label: 'Published', variant: 'info', Icon: Globe },
  ARCHIVED: { label: 'Archived', variant: 'outline', Icon: Archive },
};

const ENROLLMENT_SPECS: Record<EnrollmentStatus, StatusSpec> = {
  ACTIVE: { label: 'In progress', variant: 'warning', Icon: PlayCircle },
  COMPLETED: { label: 'Completed', variant: 'success', Icon: CheckCircle2 },
  CANCELLED: { label: 'Left', variant: 'outline', Icon: Circle },
};

function Chip({ spec, className }: { spec: StatusSpec; className?: string }) {
  return (
    <Badge variant={spec.variant} className={className}>
      <spec.Icon aria-hidden="true" />
      {spec.label}
    </Badge>
  );
}

export function LessonStatusBadge({
  status,
  className,
}: {
  status: LessonStatus;
  className?: string;
}) {
  return <Chip spec={LESSON_SPECS[status]} className={className} />;
}

export function CourseStatusBadge({
  status,
  className,
}: {
  status: CourseStatus;
  className?: string;
}) {
  return <Chip spec={COURSE_SPECS[status]} className={className} />;
}

/**
 * A learner's relationship to a course. `null` means not enrolled, which the
 * catalog shows as "Not started" so every card carries a status.
 */
export function EnrollmentStatusBadge({
  status,
  className,
}: {
  status: EnrollmentStatus | null;
  className?: string;
}) {
  if (!status) {
    return <Chip spec={LESSON_SPECS.NOT_STARTED} className={className} />;
  }
  return <Chip spec={ENROLLMENT_SPECS[status]} className={className} />;
}

export function PreviewBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={className}>
      <Eye aria-hidden="true" />
      Preview
    </Badge>
  );
}

/** Difficulty is not a status, so it stays a neutral outline chip. */
export function DifficultyBadge({
  difficulty,
  className,
}: {
  difficulty: string;
  className?: string;
}) {
  const label =
    difficulty.charAt(0) + difficulty.slice(1).toLowerCase().replace(/_/g, ' ');
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}
