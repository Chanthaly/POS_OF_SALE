
import type { Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import waitTransition from '../db/dbconfigHelper.js';
import { serviceMessage } from '../utils/service.Message.js'; 
import { genAccessJWT } from '../utils/JWTHelper.js'

import bcry  from 'bcryptjs'


 type Role  = 'user'|'admin'|'superuser'
type User = RowDataPacket & {
    user_id: number;
    username: string;
    password: string;
    role:Role
    created_at: string;
};

export const LoginUser = async (req: Request, res: Response) => {
    const { username, password } = req.body as User

    if (!username || !password) {
        return res.status(401).json({
            resultCode: 401,
            message: serviceMessage.USER_NOTEXIT
        });
    }

    try {
        const sql = 'SELECT * FROM users WHERE username = ?';

        const [rows] = await waitTransition
            .promise()
            .query<User[]>(sql, [username]);

        // No user found
        if (rows.length === 0) {
            return res.status(422).json({
                resultCode: 422,
                message: serviceMessage.USER_NOT_FOUND
            });
        }

        // Get the first matching user
        const user = rows[0];
        if(!user) {
          return res.status(404).json({
             resultCode:404,
             message:serviceMessage.USER_NOT_FOUND
          })
        }

        // Check password against the saved bcrypt hash.
        const isMatch = bcry.compareSync(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                resultCode: 401,
                message: 'INVALID PASSWORD'
            });
        }

        const accToken = genAccessJWT({
            user_id: user.user_id,
            username: user.username,
            role: user.role
        });

        return res.status(200).json({
            resultCode: 200,
            message: serviceMessage.SUCCESS,
            token: accToken,
            data: {
                user_ID: user.user_id,
                user_Name: user.username,
                user_role: user.role
            }
        });
    } catch (err) {
        console.error('Login error:', err);

        return res.status(500).json({
            resultCode: 500,
            message: 'DATABASE ERROR'
        });
    }
};
export const RegisterUser  = async (req:Request, res:Response) => {
const  {username,password, role ,created_at}  = req.body as  User

if(!username || !password || !created_at || !role || !['user','admin','superuser'].includes(role)) {
  return res.status(402).json({
    resultCode:402,
    message: serviceMessage.USER_NOTEXIT
  })
}
  
  try{
     const B_KEY = bcry.genSaltSync(10)
    const  NewPsd  = bcry.hashSync(password,B_KEY)
     const sql   =  ` INSERT INTO users (username,password,role,created_at) values(?,?,?,?)` ;
      const params = [username,NewPsd,role,created_at]
     const data  = await waitTransition.promise().query(sql,params)
     if(!data)
     {
      return res.status(401).json({
        resultCode:401,
        message:serviceMessage.OPERATION_FAILE 
      })
     }
     res.status(201).json({
      resultCode:201,
      meesage:serviceMessage.OPERATION_SUCESS
     })

  }catch(err)
  {
    console.error("err=>",err)
   return res.status(500).json({
    resultCode:500,
    message:serviceMessage.SERVER_ERROR,err
   })
  }
}


