
 import express from "express";
import {getUserByid, getUsers}   from "../controller/user.controller.js";
  export  const router  = express.Router();
 router.get("/getusers",getUsers);
 router.get("/getuser/:user_id", getUserByid);