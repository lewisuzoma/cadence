import type { Request, Response } from 'express';
import {
  adminCourseQuerySchema,
  courseInputSchema,
  courseQuerySchema,
  courseStatusUpdateSchema,
  courseUpdateSchema,
} from '@cadence/shared';
import { ok, created, noContent } from '../../lib/response.js';
import { coursesService } from './courses.service.js';

export const coursesController = {
  /** Public catalog.  Enrollment state is added only for a signed-in caller. */
  async list(req: Request, res: Response): Promise<void> {
    const query = courseQuerySchema.parse(req.query);
    const { items, meta } = await coursesService.listPublished(query, req.user?.id);
    ok(res, 'Courses retrieved', items, meta);
  },

  async categories(_req: Request, res: Response): Promise<void> {
    const categories = await coursesService.listCategories();
    ok(res, 'Categories retrieved', categories);
  },

  async detail(req: Request, res: Response): Promise<void> {
    const course = await coursesService.getDetail(req.params.idOrSlug!, req.user);
    ok(res, 'Course retrieved', course);
  },

  // --- admin -------------------------------------------------------------

  async adminList(req: Request, res: Response): Promise<void> {
    const query = adminCourseQuerySchema.parse(req.query);
    const { items, meta } = await coursesService.listForAdmin(query);
    ok(res, 'Courses retrieved', items, meta);
  },

  async adminDetail(req: Request, res: Response): Promise<void> {
    const course = await coursesService.getForAdmin(req.params.id!);
    ok(res, 'Course retrieved', course);
  },

  async create(req: Request, res: Response): Promise<void> {
    const input = courseInputSchema.parse(req.body);
    const course = await coursesService.create(input, req.user!.id);
    created(res, 'Course created', course);
  },

  async update(req: Request, res: Response): Promise<void> {
    const input = courseUpdateSchema.parse(req.body);
    const course = await coursesService.update(req.params.id!, input);
    ok(res, 'Course updated', course);
  },

  async setStatus(req: Request, res: Response): Promise<void> {
    const { status } = courseStatusUpdateSchema.parse(req.body);
    const course = await coursesService.setStatus(req.params.id!, status);
    ok(res, `Course ${status.toLowerCase()}`, course);
  },

  async remove(req: Request, res: Response): Promise<void> {
    await coursesService.remove(req.params.id!);
    noContent(res);
  },
};
