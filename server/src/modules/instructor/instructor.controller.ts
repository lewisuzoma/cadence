import type { Request, Response } from 'express';
import {
  instructorActivityQuerySchema,
  instructorCourseQuerySchema,
  instructorProfileUpdateSchema,
} from '@cadence/shared';
import { ok } from '../../lib/response.js';
import { coursesService } from '../courses/courses.service.js';
import { instructorProfileService } from './profile.service.js';
import { instructorService } from './instructor.service.js';

/**
 * HTTP for the teaching workspace.
 *
 * Publish, unpublish and archive are separate verbs over one service method:
 * the rules differ enough to deserve distinct URLs and distinct messages,
 * but the transition itself — the checklist, the event, the timestamp — must
 * happen in exactly one place.
 */
export const instructorController = {
  async dashboard(req: Request, res: Response): Promise<void> {
    const data = await instructorService.dashboard(req.user!);
    ok(res, 'Instructor dashboard retrieved', data);
  },

  async listCourses(req: Request, res: Response): Promise<void> {
    const query = instructorCourseQuerySchema.parse(req.query);
    const { items, meta, counts } = await instructorService.listCourses(query, req.user!);
    // Tab counts ride along in `meta`, which the envelope already carries,
    // rather than forcing the client into a second round trip per tab.
    ok(res, 'Courses retrieved', items, { ...meta, counts });
  },

  async activity(req: Request, res: Response): Promise<void> {
    const query = instructorActivityQuerySchema.parse(req.query);
    const { items, meta } = await instructorService.activity(query, req.user!);
    ok(res, 'Activity retrieved', items, meta);
  },

  async preview(req: Request, res: Response): Promise<void> {
    const data = await coursesService.preview(req.params.id!, req.user!);
    ok(res, 'Course preview retrieved', data);
  },

  // --- instructor profile ------------------------------------------------

  async getProfile(req: Request, res: Response): Promise<void> {
    const data = await instructorProfileService.getMine(req.user!);
    ok(res, 'Instructor profile retrieved', data);
  },

  async updateProfile(req: Request, res: Response): Promise<void> {
    const input = instructorProfileUpdateSchema.parse(req.body);
    const data = await instructorProfileService.updateMine(input, req.user!);
    ok(res, 'Instructor profile updated', data);
  },

  async publish(req: Request, res: Response): Promise<void> {
    const course = await coursesService.setStatus(req.params.id!, 'PUBLISHED', req.user!);
    ok(res, 'Course published', course);
  },

  async unpublish(req: Request, res: Response): Promise<void> {
    const course = await coursesService.setStatus(req.params.id!, 'DRAFT', req.user!);
    ok(res, 'Course moved back to drafts', course);
  },

  async archive(req: Request, res: Response): Promise<void> {
    const course = await coursesService.setStatus(req.params.id!, 'ARCHIVED', req.user!);
    ok(res, 'Course archived', course);
  },
};
