import express from "express";
// import type { Request, Response } from "express";
// import  { serviceMessage }  from "./utils/service.Message.js";
import TestConn from "./db/Testconnectdb.js";
import  {router}  from "./routers/Router.js";
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const port  = 1000;
//   app.get("/",(req:Request,res:Response) => {
//      res.send({ message: serviceMessage.SUCCESS });
//     })
 await  TestConn();
 app.use("/api",router);
app.listen(port,() => {

    console.log(`Server is running on port ${port}`);
})