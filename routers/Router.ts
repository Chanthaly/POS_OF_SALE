import  { checkCompanyActive  } from '../middleware/checkstatusCompanyActive.js';
 import express from "express";
import {EditUser, getUserByid, getUsers}   from "../controller/user.controller.js";
import {  LoginUser, RegisterUser } from "../controller/userRegister.js";
import { requireRole, verifyJWT } from "../middleware/jwt.middleware.js";
import { AddCompanyDATA, EditCPN, getCompanyID, getCompanys } from "../controller/Company.js";
import { Addbran, getBranall, getBranID } from "../controller/Bran.js";
import { addProduct, deleteProduct, getProductById, getProducts, updateProduct } from "../controller/product.controller.js";
import { cancelTransfer, createTransfer, getTransfers, receiveTransfer } from "../controller/transfer.controller.js";
import { handleImageUpload } from '../middleware/upload.middleware.js';
import { uploadImage } from '../controller/upload.controller.js';
import { addPstock, deletePstock, getPstock, updatePstock } from '../controller/Pstock.js';
import { addProductType, deleteProductType, getProductTypes, updateProductType } from '../controller/ProductType.js';
import { addProductPrice, deleteProductPrice, getProductPrices, updateProductPrice } from '../controller/ProductPrice.js';
export const router = express.Router();
// Public endpoint
router.post('/login', LoginUser)
router.post('/register', verifyJWT, RegisterUser)

// Upload an image and receive its Cloudinary URL.
router.post('/upload/image', verifyJWT, handleImageUpload, uploadImage)

// Protected routes
router.get("/getusers", verifyJWT, getUsers);
router.get("/getuser/:user_id", verifyJWT, getUserByid);
router.put("/updateusers/:user_id", verifyJWT, EditUser)

// company route
router.get('/getcompanys', verifyJWT,checkCompanyActive,getCompanys)
router.get('/getcompany/:company_id', verifyJWT,checkCompanyActive, getCompanyID)
router.post('/addcompanydata', verifyJWT, requireRole('superuser'), checkCompanyActive, AddCompanyDATA) 
router.put('/updatecompany/:company_id', verifyJWT, requireRole('superuser', 'admin'), EditCPN)

// branc 
router.get('/getbrans', verifyJWT, getBranall)
router.get('/getbran/:bran_id', verifyJWT, getBranID)

router.post('/postbran', verifyJWT, requireRole('superuser', 'admin'), Addbran)

// Product routes. Branch users are scoped to their own branch.
router.get('/products', verifyJWT, getProducts)
router.get('/product/:p_id', verifyJWT, getProductById)
router.post('/product', verifyJWT, requireRole('superuser', 'admin', 'manager'), addProduct)
router.put('/product/:p_id', verifyJWT, requireRole('superuser', 'admin', 'manager'), updateProduct)
router.delete('/product/:p_id', verifyJWT, requireRole('superuser', 'admin', 'manager'), deleteProduct)

// Stock is scoped by the product's branch and company.
router.get('/getstocks', verifyJWT, getPstock)
router.post('/addstocks', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), addPstock)
router.put('/stocks/:stock_id', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), updatePstock)
router.delete('/stocks/:stock_id', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), deletePstock)

// Product types are scoped by the product's branch and company.
router.get('/getproducttypes', verifyJWT, getProductTypes)
router.post('/addproducttypes', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), addProductType)
router.put('/producttypes/:Ptype_id', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), updateProductType)
router.delete('/producttypes/:Ptype_id', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), deleteProductType)

// Product prices are scoped by the product's branch and company.
router.get('/getproductprices', verifyJWT, getProductPrices)
router.post('/addPprices', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), addProductPrice)
router.put('/productprices/:price_id', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), updateProductPrice)
router.delete('/productprices/:price_id', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), deleteProductPrice)

// Head office creates transfers; the destination branch receives them.
router.get('/transfers', verifyJWT, getTransfers)
router.post('/transfers', verifyJWT, requireRole('superuser', 'admin'), createTransfer)
router.post('/transfers/:tr_id/receive', verifyJWT, requireRole('superuser', 'user', 'admin', 'manager', 'staff'), receiveTransfer)
router.post('/transfers/:tr_id/cancel', verifyJWT, requireRole('superuser', 'admin'), cancelTransfer)