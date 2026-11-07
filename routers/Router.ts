import  { checkCompanyActive  } from '../middleware/checkstatusCompanyActive.js';
 import express from "express";
import {EditUser, getUserByid, getUsers}   from "../controller/user.controller.js";
import {  LoginUser, RegisterUser } from "../controller/userRegister.js";
import { requireRole, verifyJWT } from "../middleware/jwt.middleware.js";
import { AddCompanyDATA, EditCPN, getCompanyID, getCompanys } from "../controller/Company.js";
import { Addbran, Editbran, getBranall, getBranID } from "../controller/Bran.js";
import { addProduct, deleteProduct, getProductById, getProducts, updateProduct } from "../controller/product.controller.js";
import { cancelTransfer, createTransfer, dispatchTransfer, getTransfers, receiveTransfer } from "../controller/transfer.controller.js";
import { handleCompanyLogoUpload, handleImageUpload } from '../middleware/upload.middleware.js';
import { uploadImage } from '../controller/upload.controller.js';
import { addPstock, deletePstock, getPstock, updatePstock } from '../controller/Pstock.js';
import { addProductType, deleteProductType, getProductTypes, updateProductType } from '../controller/ProductType.js';
import { addProductPrice, deleteProductPrice, getProductPrices, updateProductPrice } from '../controller/ProductPrice.js';
import { addTax, deleteTax, getTaxes, updateTax } from '../controller/Tax.js';
import { addProductSize, deleteProductSize, getProductSizeById, getProductSizes, updateProductSize } from '../controller/ProductSize.js';
import { createSale, getSaleById, reprintSaleReceipt } from '../controller/sales.controller.js';
import { createPrinter, deletePrinter, getPrinterById, getPrinters, updatePrinter } from '../controller/printer.controller.js';
import {
  createCustomer, createLoyaltyProgram, createLoyaltyRedemption, createLoyaltyReward,
  createLoyaltyTransaction, deleteCustomer, deleteLoyaltyProgram, deleteLoyaltyRedemption,
  deleteLoyaltyReward, deleteLoyaltyTransaction, getCustomers, getLoyaltyPrograms,
  getLoyaltyRedemptions, getLoyaltyRewards, getLoyaltyTransactions, updateCustomer,
  updateLoyaltyProgram, updateLoyaltyRedemption, updateLoyaltyReward, updateLoyaltyTransaction,
} from '../controller/loyalty.controller.js';
export const router = express.Router();
// Public endpoint
router.post('/login', LoginUser)
router.post('/register',verifyJWT, RegisterUser)

// Upload an image and receive its Cloudinary URL.
router.post('/upload/image', verifyJWT, handleImageUpload, uploadImage)

// Protected routes
router.get("/getusers", verifyJWT, getUsers);
router.get("/getuser/:user_id", verifyJWT, getUserByid);
router.put("/updateusers/:user_id", verifyJWT, EditUser)

// company route
router.get('/getcompanys', verifyJWT,checkCompanyActive,requireRole('superuser', 'admin'),getCompanys)
router.get('/getcompany/:company_id', verifyJWT,checkCompanyActive, getCompanyID)
router.post('/addcompanydata', verifyJWT, requireRole('superuser'), checkCompanyActive, handleCompanyLogoUpload, AddCompanyDATA)
router.put('/updatecompany/:company_id', verifyJWT, requireRole('superuser', 'admin'), handleCompanyLogoUpload, EditCPN)

// branc 
router.get('/getbrans', verifyJWT,requireRole('superuser', 'admin', 'manager'), getBranall)
router.get('/getbran/:bran_id', verifyJWT, getBranID)

router.post('/addbran', verifyJWT, requireRole('superuser', 'admin'), Addbran)
router.put('/updatebran/:bran_id', verifyJWT, requireRole('superuser', 'admin', 'manager'), Editbran)

// Product routes. Branch users are scoped to their own branch.
router.get('/products', verifyJWT, getProducts)
router.get('/product/:p_id', verifyJWT, getProductById)
router.post('/product', verifyJWT, requireRole('superuser', 'admin', 'manager'), addProduct)
router.put('/product/:p_id', verifyJWT, requireRole('superuser', 'admin', 'manager'), updateProduct)
router.delete('/product/:p_id', verifyJWT, requireRole('superuser', 'admin', 'manager'), deleteProduct)

// Product sizes are shared options (for example 12 ml, 1 l, and 80 mm).
router.get('/product-sizes', verifyJWT, getProductSizes)
router.get('/product-sizes/:product_size_id', verifyJWT, getProductSizeById)
router.post('/product-sizes', verifyJWT, requireRole('superuser', 'admin', 'manager'), addProductSize)
router.put('/product-sizes/:product_size_id', verifyJWT, requireRole('superuser', 'admin', 'manager'), updateProductSize)
router.delete('/product-sizes/:product_size_id', verifyJWT, requireRole('superuser', 'admin', 'manager'), deleteProductSize)

// Stock is scoped by the product's branch and company.
router.get('/getstocks', verifyJWT, getPstock)
router.post('/addstocks', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), addPstock)
router.put('/stocks/:stock_id', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), updatePstock)
router.delete('/stocks/:stock_id', verifyJWT, requireRole('superuser',  'admin', 'manager', 'staff'), deletePstock)

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

// Tax configuration is managed by company admins or the superuser.
router.get('/taxes', verifyJWT, requireRole('superuser', 'admin'), getTaxes)
router.post('/taxes', verifyJWT, requireRole('superuser', 'admin'), addTax)
router.put('/taxes/:tax_id', verifyJWT, requireRole('superuser', 'admin'), updateTax)
router.delete('/taxes/:tax_id', verifyJWT, requireRole('superuser', 'admin'), deleteTax)

// Head office creates transfers; the destination branch receives them.
router.get('/transfers', verifyJWT, getTransfers)
router.post('/createtransfers', verifyJWT, requireRole('superuser', 'admin'), createTransfer)
router.post('/transfers/:tr_id/dispatch', verifyJWT, requireRole('superuser', 'admin', 'manager', 'staff'), dispatchTransfer)
router.post('/transfers/:tr_id/receive', verifyJWT, requireRole('superuser', 'user', 'admin', 'manager', 'staff'), receiveTransfer)
router.post('/transfers/:tr_id/cancel', verifyJWT, requireRole('superuser', 'admin'), cancelTransfer)

// Sales are committed with their item, tax, discount, and stock changes in one transaction.
router.post('/sales', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'),createSale)
router.get('/sales/:sale_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), getSaleById)
router.post('/sales/:sale_id/print', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), reprintSaleReceipt)

// Printers are managed per branch; USB devices are inventory-only on the server.
router.get('/printers', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), getPrinters)
router.get('/printers/:printer_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), getPrinterById)
router.post('/printers', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), createPrinter)
router.put('/printers/:printer_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), updatePrinter)
router.delete('/printers/:printer_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), deletePrinter)

// Loyalty CRUD is scoped to the company in the JWT; superusers pass company_id in query/body.
// ดึงรายชื่อลูกค้าทั้งหมดของบริษัท
router.get('/loyalty/customers', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), getCustomers)
// ดึงข้อมูลลูกค้ารายเดียวตาม customer_id
router.get('/loyalty/customers/:customer_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), getCustomers)
// เพิ่มลูกค้าใหม่ในระบบสะสมแต้ม
router.post('/loyalty/customers', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), createCustomer)
// แก้ไขข้อมูลลูกค้าตาม customer_id
router.put('/loyalty/customers/:customer_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), updateCustomer)
// ลบข้อมูลลูกค้าตาม customer_id
router.delete('/loyalty/customers/:customer_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), deleteCustomer)

// ดูกติกาสะสมแต้มของบริษัท เช่น ยอดซื้อขั้นต่ำและจำนวนแต้มที่ได้รับ
router.get('/loyalty/programs', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), getLoyaltyPrograms)
// สร้างกติกาสะสมแต้มใหม่ให้บริษัท
router.post('/loyalty/programs', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin'), createLoyaltyProgram)
// แก้ไขกติกาสะสมแต้มตาม program_id
router.put('/loyalty/programs/:program_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin'), updateLoyaltyProgram)
// ลบกติกาสะสมแต้มตาม program_id
router.delete('/loyalty/programs/:program_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin'), deleteLoyaltyProgram)

// ดึงรายการของรางวัลทั้งหมดของบริษัท
router.get('/loyalty/rewards', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), getLoyaltyRewards)
// ดึงข้อมูลของรางวัลรายการเดียวตาม reward_id
router.get('/loyalty/rewards/:reward_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), getLoyaltyRewards)
// เพิ่มของรางวัลที่ใช้แต้มแลก เช่น ส่วนลดหรือสินค้า
router.post('/loyalty/rewards', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), createLoyaltyReward)
// แก้ไขรายละเอียดของรางวัลตาม reward_id
router.put('/loyalty/rewards/:reward_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), updateLoyaltyReward)
// ลบของรางวัลตาม reward_id
router.delete('/loyalty/rewards/:reward_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), deleteLoyaltyReward)

// ดึงประวัติรายการแต้มทั้งหมดของบริษัท
router.get('/loyalty/transactions', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), getLoyaltyTransactions)
// ดึงรายการแต้มรายการเดียวตาม transaction_id
router.get('/loyalty/transactions/:transaction_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), getLoyaltyTransactions)
// บันทึกรายการแต้มของลูกค้า เช่น ได้รับ ใช้ หรือปรับแต้ม
router.post('/loyalty/transactions', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), createLoyaltyTransaction)
// แก้ไขรายการแต้มตาม transaction_id
router.put('/loyalty/transactions/:transaction_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), updateLoyaltyTransaction)
// ลบรายการแต้มตาม transaction_id
router.delete('/loyalty/transactions/:transaction_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin'), deleteLoyaltyTransaction)

// ดึงประวัติการแลกรางวัลทั้งหมดของบริษัท
router.get('/loyalty/redemptions', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), getLoyaltyRedemptions)
// ดึงประวัติการแลกรางวัลรายการเดียวตาม redemption_id
router.get('/loyalty/redemptions/:redemption_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), getLoyaltyRedemptions)
// บันทึกการแลกรางวัลของลูกค้าและเชื่อมกับรายการแต้มที่ใช้
router.post('/loyalty/redemptions', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager', 'cashier', 'staff'), createLoyaltyRedemption)
// แก้ไขรายละเอียดหรือสถานะการแลกรางวัลตาม redemption_id
router.put('/loyalty/redemptions/:redemption_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin', 'manager'), updateLoyaltyRedemption)
// ลบประวัติการแลกรางวัลตาม redemption_id
router.delete('/loyalty/redemptions/:redemption_id', verifyJWT, checkCompanyActive, requireRole('superuser', 'admin'), deleteLoyaltyRedemption)