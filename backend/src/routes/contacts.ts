import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roleGuard';
import {
  archive, create, detail, list, messages, sendMessage, update,
} from '../controllers/contactController';

const router = Router();

router.use(requireAuth);

// Scoping is by role INSIDE the service (`visibleContacts`), not by a guard
// here: a Manager sees their own contacts on the same route an Admin uses to
// see all of them, exactly as `/api/users` works.
router.get('/',              asyncRoute(list));
router.get('/:id',           asyncRoute(detail));
router.get('/:id/messages',  asyncRoute(messages));

router.post('/',             requireRole('Admin', 'Manager'), asyncRoute(create));
router.post('/:id/messages', requireRole('Admin', 'Manager'), asyncRoute(sendMessage));
router.patch('/:id',         requireRole('Admin', 'Manager'), asyncRoute(update));

// Archive, never delete — a contact who has been messaged owns Message rows,
// and losing the record of what was sent to whom is the worst outcome here.
router.delete('/:id',        requireRole('Admin'), asyncRoute(archive));

export default router;
