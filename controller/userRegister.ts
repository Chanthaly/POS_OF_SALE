 import type { Request,Response} from 'express'
 import  waitTransition from '../db/dbconfigHelper.js'
import { serviceMessage } from '../utils/service.Message.js';
 type Reuser = {
    username:string,
    password: string,
      role:   'user' | 'admin' | 'superuser',
      created_at: string,
      company_id: number
      bran_id: number,

 }
 export const RegisterUser =  async (req:Request,res:Response) => {
    const {username,password,role,created_at,company_id,bran_id } = req.body  as any | Reuser;
    if(!username || !password || !role || !created_at || !company_id || !bran_id )
    {
        return res.status(401).json({
             resultCode:401,
             message:serviceMessage.USER_NOT_EXIST
        })
    }
  if (['user', 'admin', 'superuser'].includes(role)) {
     
}


 }