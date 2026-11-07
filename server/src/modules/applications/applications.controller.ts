import type { Request, Response } from 'express';
import {
  adminApplicationQuerySchema,
  adminInstructorQuerySchema,
  applicationNoteSchema,
  approveApplicationSchema,
  instructorApplicationInputSchema,
  instructorApplicationUpdateSchema,
  reinstateInstructorSchema,
  rejectApplicationSchema,
  suspendInstructorSchema,
} from '@cadence/shared';
import { created, ok } from '../../lib/response.js';
import { applicationsService } from './applications.service.js';

/**
 * HTTP for the application workflow.
 *
 * The applicant's endpoints are all `/me`-shaped: there is no path where an
 * id in the URL selects *which* application to act on, so an applicant
 * cannot reach anyone else's by changing a number.
 */
export const applicationsController = {
  // --- applicant ---------------------------------------------------------

  async getMine(req: Request, res: Response): Promise<void> {
    const data = await applicationsService.getMine(req.user!);
    ok(res, 'Application status retrieved', data);
  },

  async apply(req: Request, res: Response): Promise<void> {
    const input = instructorApplicationInputSchema.parse(req.body);
    await applicationsService.apply(input, req.user!);
    // The status payload, not the raw row: it is what the page renders next,
    // and it saves the client an immediate follow-up request.
    const data = await applicationsService.getMine(req.user!);
    created(res, 'Application submitted', data);
  },

  async updateMine(req: Request, res: Response): Promise<void> {
    const input = instructorApplicationUpdateSchema.parse(req.body);
    await applicationsService.updateMine(input, req.user!);
    const data = await applicationsService.getMine(req.user!);
    ok(res, 'Application updated', data);
  },

  async withdrawMine(req: Request, res: Response): Promise<void> {
    await applicationsService.withdrawMine(req.user!);
    const data = await applicationsService.getMine(req.user!);
    ok(res, 'Application withdrawn', data);
  },

  // --- admin review ------------------------------------------------------

  async list(req: Request, res: Response): Promise<void> {
    const query = adminApplicationQuerySchema.parse(req.query);
    const { items, meta, counts } = await applicationsService.listForAdmin(query);
    ok(res, 'Applications retrieved', items, { ...meta, counts });
  },

  async detail(req: Request, res: Response): Promise<void> {
    const data = await applicationsService.getForAdmin(req.params.id!, req.user!);
    ok(res, 'Application retrieved', data);
  },

  async approve(req: Request, res: Response): Promise<void> {
    const input = approveApplicationSchema.parse(req.body ?? {});
    await applicationsService.approve(req.params.id!, input, req.user!);
    const data = await applicationsService.getForAdmin(req.params.id!, req.user!);
    ok(res, 'Application approved', data);
  },

  async reject(req: Request, res: Response): Promise<void> {
    const input = rejectApplicationSchema.parse(req.body);
    await applicationsService.reject(req.params.id!, input, req.user!);
    const data = await applicationsService.getForAdmin(req.params.id!, req.user!);
    ok(res, 'Application rejected', data);
  },

  async addNote(req: Request, res: Response): Promise<void> {
    const { note } = applicationNoteSchema.parse(req.body);
    await applicationsService.addNote(req.params.id!, note, req.user!);
    const data = await applicationsService.getForAdmin(req.params.id!, req.user!);
    ok(res, 'Note added', data);
  },

  // --- instructor management ---------------------------------------------

  async listInstructors(req: Request, res: Response): Promise<void> {
    const query = adminInstructorQuerySchema.parse(req.query);
    const { items, meta, counts } = await applicationsService.listInstructors(query);
    ok(res, 'Instructors retrieved', items, { ...meta, counts });
  },

  async suspend(req: Request, res: Response): Promise<void> {
    const input = suspendInstructorSchema.parse(req.body);
    await applicationsService.suspend(req.params.id!, input, req.user!);
    ok(res, 'Instructor suspended', { userId: req.params.id, status: 'SUSPENDED' });
  },

  async reinstate(req: Request, res: Response): Promise<void> {
    const input = reinstateInstructorSchema.parse(req.body ?? {});
    await applicationsService.reinstate(req.params.id!, input.reason, req.user!);
    ok(res, 'Instructor reinstated', { userId: req.params.id, status: 'ACTIVE' });
  },
};
