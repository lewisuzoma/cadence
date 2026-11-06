import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BookOpen, CheckCircle2, GraduationCap, Users } from 'lucide-react';
import { ActivityRow } from '@/components/dashboard/ActivityRow';
import { ErrorState } from '@/components/common/States';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard, StatCardSkeletonRow } from '@/components/dashboard/StatCard';
import { CourseStatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminDashboard } from '@/features/dashboard/dashboard.queries';

/**
 * Admin overview and activity.
 *
 * Every figure comes from `GET /dashboard/admin`, which aggregates in SQL.
 * The chart plots enrollments and completions per published course from the
 * same payload — there is no client-side arithmetic beyond formatting.
 */
export function AdminOverviewPage() {
  const { data, isPending, isError, refetch } = useAdminDashboard();

  if (isError) {
    return <ErrorState title="Could not load the dashboard" onRetry={() => void refetch()} />;
  }
  if (isPending) return <AdminOverviewSkeleton />;

  const { stats, coursePerformance, recentActivity, recentCourses } = data;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        overline="Admin"
        title="Activity"
        description="Learner progress and course activity across the platform."
        actions={
          <Button asChild>
            <Link to="/admin/courses">Manage courses</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Learners"
          value={stats.learners}
          hint={`${stats.activeLearners} active`}
          icon={Users}
        />
        <StatCard
          label="Courses"
          value={stats.courses}
          hint={`${stats.publishedCourses} published · ${stats.draftCourses} draft · ${stats.archivedCourses} archived`}
          icon={BookOpen}
        />
        <StatCard
          label="Enrollments"
          value={stats.enrollments}
          hint={`${stats.completedCourses} courses completed`}
          icon={GraduationCap}
        />
        <StatCard
          label="Lessons completed"
          value={stats.completedLessons}
          hint={`of ${stats.lessons} lessons on the platform`}
          icon={CheckCircle2}
        />
      </div>

      {/* Course performance */}
      <section aria-labelledby="performance-heading" className="flex flex-col gap-4">
        <h2 id="performance-heading" className="font-heading text-heading-sm">
          Course activity
        </h2>

        {coursePerformance.length === 0 ? (
          <Card className="p-6 text-small text-secondary-foreground">
            Publish a course to see enrollment and completion figures here.
          </Card>
        ) : (
          <Card className="flex flex-col gap-6 p-5">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={coursePerformance}
                  margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="title"
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(value: string) =>
                      value.length > 18 ? `${value.slice(0, 17)}…` : value
                    }
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid hsl(var(--border))',
                      fontSize: 13,
                    }}
                  />
                  <Bar
                    dataKey="enrollments"
                    name="Enrollments"
                    fill="hsl(var(--primary))"
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    dataKey="completions"
                    name="Completions"
                    fill="hsl(var(--success))"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* The same numbers as text, for anyone who cannot read a chart. */}
            <table className="w-full text-small">
              <caption className="sr-only">
                Enrollments, completions and completion rate per published course
              </caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-2 text-overline uppercase text-muted-foreground">
                    Course
                  </th>
                  <th scope="col" className="py-2 text-overline uppercase text-muted-foreground">
                    Enrolled
                  </th>
                  <th scope="col" className="py-2 text-overline uppercase text-muted-foreground">
                    Completed
                  </th>
                  <th scope="col" className="py-2 text-overline uppercase text-muted-foreground">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {coursePerformance.map((row) => (
                  <tr key={row.courseId} className="border-b border-border last:border-0">
                    <td className="py-2.5">{row.title}</td>
                    <td className="py-2.5 tabular">{row.enrollments}</td>
                    <td className="py-2.5 tabular">{row.completions}</td>
                    <td className="py-2.5 tabular">{row.completionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent activity */}
        <section aria-labelledby="recent-activity-heading" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-activity-heading" className="font-heading text-heading-sm">
              Recent activity
            </h2>
            <Button asChild variant="ghost">
              <Link to="/admin/activity">See all</Link>
            </Button>
          </div>
          {recentActivity.length === 0 ? (
            <Card className="p-6 text-small text-secondary-foreground">
              Nothing has happened yet.
            </Card>
          ) : (
            <Card className="divide-y divide-border">
              {recentActivity.map((item) => (
                <ActivityRow key={item.id} item={item} showUser />
              ))}
            </Card>
          )}
        </section>

        {/* Recently updated courses */}
        <section aria-labelledby="recent-courses-heading" className="flex flex-col gap-4">
          <h2 id="recent-courses-heading" className="font-heading text-heading-sm">
            Recently updated
          </h2>
          <Card className="divide-y divide-border">
            {recentCourses.map((course) => (
              <div key={course.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/admin/courses/${course.id}/lessons`}
                    className="block truncate text-small font-semibold hover:text-primary-hover"
                  >
                    {course.title}
                  </Link>
                  <p className="text-caption text-muted-foreground">
                    {course.category} · {course.lessonCount} lessons
                  </p>
                </div>
                <CourseStatusBadge status={course.status} />
              </div>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}

function AdminOverviewSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-12 w-56" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardSkeletonRow count={4} />
      </div>
      <Skeleton className="h-80 w-full rounded-lg" />
    </div>
  );
}
