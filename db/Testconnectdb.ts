import  WaitTransaction  from "./dbconfigHelper.js";
import { serviceMessage }  from "../utils/service.Message.js";
  const  TestConn  =  async () => {
   try {
    const  Pool  = await  WaitTransaction.promise().getConnection();
       console.log({message:serviceMessage.DATABASE_CONNECTION_SUCCESS});
       Pool.release();
   }
   catch(err) {
   console.log({message:serviceMessage.DATABASE_CONNECTION_ERROR, error:err});
   process.exit(1);
   }

  }
  export default TestConn;