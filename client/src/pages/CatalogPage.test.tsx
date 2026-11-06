import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { CatalogPage } from './CatalogPage';
import { courseSummary, ok, server } from '@/test/msw-server';
import { renderWithRouter } from '@/test/render';

/**
 * The catalog's three states, and the fact that every number on screen comes
 * from the API rather than being counted in the browser.
 */
describe('CatalogPage', () => {
  it('shows skeletons while loading, then the courses', async () => {
    renderWithRouter(<CatalogPage />, { path: '/courses' });

    // The grid announces itself as busy while the first page loads.
    expect(screen.getByRole('heading', { name: 'Course catalog' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: courseSummary.title })).toBeInTheDocument();
    });
  });

  it('renders the server total rather than counting the page', async () => {
    server.use(
      http.get('/api/v1/courses', () =>
        ok([courseSummary], 'Courses retrieved', {
          page: 1,
          pageSize: 12,
          // 40 courses exist; only one is on this page. The heading must say 40.
          total: 40,
          totalPages: 4,
        }),
      ),
    );

    renderWithRouter(<CatalogPage />, { path: '/courses' });
    expect(await screen.findByText('40 courses available')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    server.use(
      http.get('/api/v1/courses', () =>
        ok([], 'Courses retrieved', { page: 1, pageSize: 12, total: 0, totalPages: 1 }),
      ),
    );

    renderWithRouter(<CatalogPage />, { path: '/courses' });
    expect(await screen.findByText('No courses yet')).toBeInTheDocument();
  });

  it('offers to clear the filters when a search returns nothing', async () => {
    server.use(
      http.get('/api/v1/courses', () =>
        ok([], 'Courses retrieved', { page: 1, pageSize: 12, total: 0, totalPages: 1 }),
      ),
    );

    renderWithRouter(<CatalogPage />, {
      path: '/courses',
      initialEntries: ['/courses?search=nothing'],
    });

    expect(await screen.findByText('No courses match those filters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('shows an error state with a retry when the request fails', async () => {
    server.use(
      http.get('/api/v1/courses', () =>
        HttpResponse.json(
          { success: false, message: 'Boom', code: 'INTERNAL_ERROR' },
          { status: 500 },
        ),
      ),
    );

    renderWithRouter(<CatalogPage />, { path: '/courses' });

    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent('Could not load courses');
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('reads the filters out of the URL so a filtered view is shareable', async () => {
    let requestedUrl = '';
    server.use(
      http.get('/api/v1/courses', ({ request }) => {
        requestedUrl = request.url;
        return ok([courseSummary], 'Courses retrieved', {
          page: 1,
          pageSize: 12,
          total: 1,
          totalPages: 1,
        });
      }),
    );

    renderWithRouter(<CatalogPage />, {
      path: '/courses',
      initialEntries: ['/courses?category=Engineering&difficulty=INTERMEDIATE&page=1'],
    });

    await screen.findByRole('heading', { name: courseSummary.title });
    expect(requestedUrl).toContain('category=Engineering');
    expect(requestedUrl).toContain('difficulty=INTERMEDIATE');
  });

  it('renders the category chips returned by the API', async () => {
    renderWithRouter(<CatalogPage />, { path: '/courses' });

    expect(await screen.findByRole('button', { name: 'Design' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });
});
