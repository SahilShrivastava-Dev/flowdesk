import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  setStatus,
  approveTask,
  rejectTask,
  retractApproval,
  escalateTask,
  reassignTask,
} from '../controllers/taskController';

const router = Router();

router.use(requireAuth);

router.get('/', listTasks);
router.post('/', createTask);
router.get('/:id', getTask);
router.patch('/:id', updateTask);
router.post('/:id/status', setStatus);
router.post('/:id/approve', approveTask);
router.post('/:id/retract', retractApproval);
router.post('/:id/reject', rejectTask);
router.post('/:id/escalate', escalateTask);
router.post('/:id/reassign', reassignTask);

export default router;
