import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listNotifications } from '../controllers/notificationController';

const router = Router();
router.use(requireAuth);
router.get('/', listNotifications);

export default router;
