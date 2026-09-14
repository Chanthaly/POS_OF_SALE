import { checkCompanyActive } from './../middleware/checkstatusCompany';

 import express from "express";
import {EditUser, getUserByid, getUsers}   from "../controller/user.controller.js";
import {  LoginUser, RegisterUser } from "../controller/userRegister.js";
import { requireRole, verifyJWT } from "../middleware/jwt.middleware.js";
import { AddCompanyDATA, EditCPN, getCompanyID, getCompanys } from "../controller/Company.js";
import { Addbran, getBranall, getBranID } from "../controller/Bran.js";
import { addProduct, deleteProduct, getProductById, getProducts, updateProduct } from "../controller/product.controller.js";
import { cancelTransfer, createTransfer, getTransfers, receiveTransfer } from "../controller/transfer.controller.js";

export const router = express.Router();

// Public endpoint
router.post('/login', LoginUser)
router.post('/register', verifyJWT, RegisterUser)

// Protected routes
router.get("/getusers", verifyJWT, getUsers);
router.get("/getuser/:user_id", verifyJWT, getUserByid);
router.put("/updateusers/:user_id", verifyJWT, EditUser)

// company route
router.get('/getcompanys', verifyJWT,checkCompanyActive,getCompanys)
router.get('/getcompany/:company_id', verifyJWT,checkCompanyActive, getCompanyID)
router.post('/addcompanydata', verifyJWT, requireRole('superuser'), AddCompanyDATA) 
router.put('/updatecompany/:company_id', verifyJWT, requireRole('superuser'), EditCPN)

// branc 
router.get('/getbrans', verifyJWT, getBranall)
router.get('/getbran/:bran_id', verifyJWT, getBranID)

router.post('/postbran', verifyJWT, requireRole('superuser'), Addbran)

// Product routes. Branch users are scoped to their own branch.
router.get('/products', verifyJWT, getProducts)
router.get('/product/:p_id', verifyJWT, getProductById)
router.post('/product', verifyJWT, requireRole('superuser', 'admin', 'manager'), addProduct)
router.put('/product/:p_id', verifyJWT, requireRole('superuser', 'admin', 'manager'), updateProduct)
router.delete('/product/:p_id', verifyJWT, requireRole('superuser', 'admin', 'manager'), deleteProduct)

// Head office creates transfers; the destination branch receives them.
router.get('/transfers', verifyJWT, getTransfers)
router.post('/transfers', verifyJWT, requireRole('superuser'), createTransfer)
router.post('/transfers/:tr_id/receive', verifyJWT, requireRole('superuser', 'user', 'admin', 'manager', 'staff'), receiveTransfer)
router.post('/transfers/:tr_id/cancel', verifyJWT, requireRole('superuser'), cancelTransfer)