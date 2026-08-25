import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roleGuard';
import { create, list, outstanding, update } from '../controllers/invoiceController';

const router = Router();

router.use(requireAuth);

router.get('/', asyncRoute(list));
router.get('/outstanding/:contactId', asyncRoute(outstanding));

router.post('/',     requireRole('Admin', 'Manager'), asyncRoute(create));
router.patch('/:id', requireRole('Admin', 'Manager'), asyncRoute(update));

export default router;
