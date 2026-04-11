import express from "express";
import {registerUser} from '../controller/registerUser'
import { userLogin } from "../controller/userLogin";
import { authenticateJWT } from "../utils/jwt";
import { examinerDashboard } from "../controller/examinerDashboard";
import { updateProfilePic } from "../controller/updateProfilePic";

const router = express.Router();

// Handles registration from StudentRegister.tsx and ExaminerRegister.tsx
router.post('/auth/:role/register', registerUser);

// Handles login from StudentLogin.tsx and ExaminerLogin.tsx
router.post('/auth/:role/login', userLogin);

// ===============================
//         EXAMINER ROUTES
// ===============================

// Update profile image (photo) for authenticated user
router.get('/examiner/dashbard', examinerDashboard);
//to do

router.put('/auth/profile-image', authenticateJWT, updateProfilePic)
export default router;