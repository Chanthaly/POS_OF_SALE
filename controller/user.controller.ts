
import type { Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import bcrypt from 'bcryptjs'
import WaitTransition from '../db/dbconfigHelper.js';
import { serviceMessage } from '../utils/service.Message.js';

type User = RowDataPacket & {
  user_id: number;
  username: string;
  password: string;
  role: 'user' | 'admin' | 'superuser';
 updated_at: string;
};

export const getUsers = async (
  req: Request,
  res: Response
) => {
  try {
    const { search } = req.query;

    let sql = `
      SELECT
        user_id,
        username,
        role,
        created_at
      FROM users
    `;

    const params: string[] = [];

    // Search username
    if (
      typeof search === 'string' &&
      search.trim() !== ''
    ) {
      sql += ` WHERE username LIKE ?`;
      params.push(`${search.trim()}%`);
    }

    sql += ` ORDER BY user_id DESC`;

    const [rows] = await WaitTransition
      .promise()
      .query<User[]>(sql, params);

    if (rows.length === 0) {
      return res.status(404).json({
        resultCode: 404,
        message: serviceMessage.USER_NOT_FOUND,
        data: [],
      });
    }

    return res.status(200).json({
      resultCode: 200,
      message: serviceMessage.SUCCESS,
      data: rows,
    });

  } catch (err) {
    console.error('Get users error:', err);

    return res.status(500).json({
      resultCode: 500,
      message: serviceMessage.SERVER_ERROR,
      error: err,
    });
  }
};

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

export const EditUser  = async (req:Request, res:Response) => {
  const {user_id} = req.params as User;
const  {username,password, role ,updated_at}  = req.body as  User

if(!username || !password || !updated_at || !role || !['user','admin','superuser'].includes(role)) {
  return res.status(402).json({
    resultCode:402,
    message: serviceMessage.USER_NOTEXIT
  })
}
  
  try{

     const B_KEY = bcrypt.genSaltSync(10)
    const  NewPsd  =  bcrypt.hashSync(password,B_KEY)
     const sql   =  ` UPDATE users SET USERNAME=?,PASSWORD=?,ROLE=?,UPDATED_AT=? WHERE USER_ID = ?` ;
      const params = [username,NewPsd,role,updated_at,user_id]
     const data  = await WaitTransition.promise().query(sql,params)
     if(!data)
     {
      return res.status(401).json({
        resultCode:401,
        message:serviceMessage.USER_NOT_FOUND
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


