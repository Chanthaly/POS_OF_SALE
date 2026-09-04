
 import express from "express";
import {EditUser, getUserByid, getUsers}   from "../controller/user.controller.js";
import {  LoginUser, RegisterUser } from "../controller/userRegister.js";
import { requireRole, verifyJWT } from "../middleware/jwt.middleware.js";
import { AddCompanyDATA, EditCPN, getCompanyID, getCompanys } from "../controller/Company.js";
import { Addbran, getBranall, getBranID } from "../controller/Bran.js";

export const router = express.Router();

// Public endpoint
router.post('/login', LoginUser)
router.post('/register', verifyJWT, RegisterUser)

// Protected routes
router.get("/getusers", verifyJWT, getUsers);
router.get("/getuser/:user_id", verifyJWT, getUserByid);
router.put("/updateusers/:user_id", verifyJWT, EditUser)

// company route
router.get('/getcompanys', verifyJWT,getCompanys)
router.get('/getcompany/:company_id', verifyJWT, getCompanyID)
router.post('/addcompanydata', verifyJWT, requireRole('superuser'), AddCompanyDATA) 
router.put('/updatecompany/:company_id', verifyJWT, requireRole('superuser'), EditCPN)

// branc 
router.get('/getbrans', verifyJWT, getBranall)
router.get('/getbran/:bran_id', verifyJWT, getBranID)
router.post('/postbran', verifyJWT, requireRole('superuser'), Addbran)