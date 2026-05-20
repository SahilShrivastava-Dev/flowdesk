import { Router } from 'express';
import { verifyWebhook, receiveWebhook } from '../controllers/webhookController';

const router = Router();

router.get('/', verifyWebhook);
router.post('/', receiveWebhook);

export default router;
