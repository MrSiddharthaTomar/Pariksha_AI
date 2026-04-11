import express from "express";
import {registerUser} from '../controller/registerUser'
import { userLogin } from "../controller/userLogin";
import { authenticateJWT } from "../utils/jwt";

const router = express.Router();

// Handles registration from StudentRegister.tsx and ExaminerRegister.tsx
router.post('/auth/:role/register', registerUser);

// Handles login from StudentLogin.tsx and ExaminerLogin.tsx
router.post('/auth/:role/login', userLogin);


router.put('/auth/profile-image', authenticateJWT, )
export default router;