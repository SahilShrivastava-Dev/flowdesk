import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roleGuard';
import { listUsers, createUser, updateUser, deleteUser } from '../controllers/userController';

const router = Router();

router.use(requireAuth);

router.get('/', listUsers);
router.post('/', requireRole('Admin'), createUser);
router.patch('/:id', updateUser);
router.delete('/:id', requireRole('Admin'), deleteUser);

export default router;
