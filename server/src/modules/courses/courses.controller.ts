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

/**
 * HTTP only: parse, delegate, respond.
 *
 * Every management handler passes `req.user` into the service as the actor.
 * The service — not this layer — decides what that actor may touch, which is
 * why the instructor and admin routes can share these handlers without the
 * ownership rule being written twice.
 */
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

  // --- management (admin and instructor share these) ---------------------

  async adminList(req: Request, res: Response): Promise<void> {
    const query = adminCourseQuerySchema.parse(req.query);
    const { items, meta } = await coursesService.listForAdmin(query);
    ok(res, 'Courses retrieved', items, meta);
  },

  async adminDetail(req: Request, res: Response): Promise<void> {
    const course = await coursesService.getForManagement(req.params.id!, req.user!);
    ok(res, 'Course retrieved', course);
  },

  async create(req: Request, res: Response): Promise<void> {
    const input = courseInputSchema.parse(req.body);
    const course = await coursesService.create(input, req.user!);
    created(res, 'Course created', course);
  },

  async update(req: Request, res: Response): Promise<void> {
    const input = courseUpdateSchema.parse(req.body);
    const course = await coursesService.update(req.params.id!, input, req.user!);
    ok(res, 'Course updated', course);
  },

  async setStatus(req: Request, res: Response): Promise<void> {
    const { status } = courseStatusUpdateSchema.parse(req.body);
    const course = await coursesService.setStatus(req.params.id!, status, req.user!);
    ok(res, `Course ${status.toLowerCase()}`, course);
  },

  async remove(req: Request, res: Response): Promise<void> {
    await coursesService.remove(req.params.id!, req.user!);
    noContent(res);
  },

  /** The publish checklist, so the editor can show it before anyone clicks. */
  async publishChecklist(req: Request, res: Response): Promise<void> {
    const checklist = await coursesService.publishChecklist(req.params.id!, req.user!);
    ok(res, 'Publish checklist retrieved', checklist);
  },
};
