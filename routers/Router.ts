
 import express from "express";
import {EditUser, getUserByid, getUsers}   from "../controller/user.controller.js";
import {  LoginUser, RegisterUser } from "../controller/userRegister.js";
import { verifyJWT } from "../middleware/jwt.middleware.js";
import { AddCompanyDATA, EditCPN, getCompanyID, getCompanys } from "../controller/Brans.js";

export const router = express.Router();

// Public endpoint
router.post('/login', LoginUser)
router.post('/register', RegisterUser)

// Protected routes
router.get("/getusers", verifyJWT, getUsers);
router.get("/getuser/:user_id", verifyJWT, getUserByid);
router.put("/updateusers/:user_id",EditUser)

// company route
router.get('/getcompanys', getCompanys) 
router.get('/getcompany/:company_id', getCompanyID) 
router.post('/addcompanydata',AddCompanyDATA) 
router.put('/updatecompany/:company_id',EditCPN)