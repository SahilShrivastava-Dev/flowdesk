import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roleGuard';
import { list } from '../controllers/commandLogController';

const router = Router();

router.use(requireAuth);

// Admin only: these rows are other people's instructions, including the ones
// that were refused.
router.get('/', requireRole('Admin'), asyncRoute(list));

export default router;
