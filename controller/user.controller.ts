import  WaitTransition from '../db/dbconfigHelper.js';
import  { serviceMessage} from '../utils/service.Message.js';
import  type {Request,Response} from 'express';


 // getUsers function to fetch users from the database
export  const getUsers  = async (req:Request,res:Response) => {
   try
   {
    const  result  =   await  WaitTransition.promise().query("SELECT * FROM users");
  if(!result)
  {
    return res.status(404).json({message:serviceMessage.USER_NOT_FOUND});
  } else {
    return res.status(200).json({
        ResultCode: 200,
        ResultMessage: serviceMessage.SUCCESS,
        ResultData: result.slice(0,1)
    })
  }

   }
 catch(err)
 {
    return res.status(500).json({message:serviceMessage.SERVER_ERROR, error:err});
 }

}
type  UserID = {
    user_id:number
}
 export  const  getUserByid  = async (req:Request,res:Response) => {
     const {user_id} = req.params as unknown as UserID;
     if(!user_id)  {
        return res.status(400).json({
            resultCode:400,
            message:  serviceMessage.ID_NOT_FOUND
        })
     }
     try
     
     {


        const  result  = await WaitTransition.promise().query("SELECT * FROM users WHERE user_id = ?",[user_id]);
        if(!result || result.length <= 0) {
            return res.status(404).json({
                resultCode:404,
                message:serviceMessage.USER_NOT_FOUND
            })
        } else {
            return res.status(200).json({
                resultCode:200,
                resultMessage: serviceMessage.SUCCESS,
                resultData: result[0]
            })
        }
     }
   catch(err)
   {
  return res.status(500).json({
    resultCode:500,
    message:serviceMessage.SERVER_ERROR, err
  })


   }
}