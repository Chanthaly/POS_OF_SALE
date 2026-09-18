
import type { Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import bcrypt from 'bcryptjs'
import WaitTransition from '../db/dbconfigHelper.js';
import { serviceMessage } from '../utils/service.Message.js';
import type { ResultSetHeader } from 'mysql2';

type User = RowDataPacket & {
  user_id: number;
  username: string;
  password: string;
  role: 'user' | 'admin' | 'superuser';
 updated_at: string;
  company_id: number | null;
  status: 'active' | 'inactive'
  bran_id: number | null;
};

export const getUsers = async (
  req: Request,
  res: Response
) => {
  try {
    const { search } = req.query;
    const isSuperuser = req.user?.user_role === 'superuser';
    const companyId = req.user?.company_id;
    const branchId = req.user?.bran_id;

    if (!isSuperuser && !companyId) {
      return res.status(403).json({ resultCode: 403, message: 'User company is not assigned' });
    }

    let sql = `
      SELECT
        user_id,
        username,
        role,
        created_at, 
        status
      FROM users
    `;

    const params: (string | number)[] = [];

    if (!isSuperuser) {
      sql += ` WHERE company_id = ?`;
      params.push(companyId!);
    }
    if (!isSuperuser && branchId) {
      sql += ` AND bran_id = ?`;
      params.push(branchId);
    }

    // Search username
    if (
      typeof search === 'string' &&
      search.trim() !== ''
    ) {
      sql += `${isSuperuser ? ' WHERE' : ' AND'} username LIKE ?`;
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
      try {
        const isSuperuser = req.user?.user_role === 'superuser';
        const companyId = req.user?.company_id;
        const branchId = req.user?.bran_id;
        if (!isSuperuser && !companyId) {
          return res.status(403).json({ resultCode: 403, message: 'User company is not assigned' });
        }
        const scopeSql = !isSuperuser && branchId ? ' AND company_id = ? AND bran_id = ?' : !isSuperuser ? ' AND company_id = ?' : '';
        const scopeParams = !isSuperuser && branchId ? [user_id, companyId, branchId] : !isSuperuser ? [user_id, companyId] : [user_id];
        const [result] = await WaitTransition.promise().query<User[]>(
          `SELECT * FROM users WHERE user_id = ?${scopeSql}`,
          scopeParams
        );
        if (result.length === 0) {
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
  const userId = Number(req.params.user_id);
const  {username,password, role ,updated_at,status, company_id, bran_id}  = req.body as  User

console.log(userId)
console.log(username)
console.log(password)
console.log(role)
console.log(updated_at)
console.log(status)



if (!Number.isInteger(userId) || userId <= 0) {
  return res.status(400).json({
    resultCode: 400,
    message: serviceMessage.ID_NOT_FOUND
  });
}

if(!username || !password ||  !updated_at || !role || !['user','admin','superuser','staff','cashier','manager'].includes(role) ||  !['active','inactive'].includes(status)) {
  return res.status(402).json({
    resultCode:402,
    message: serviceMessage.USER_NOTEXIT
  })
}
  
  try{
    const isSuperuser = req.user?.user_role === 'superuser';

    const scopedCompanyId = isSuperuser ? company_id : req.user?.company_id;
    const scopedBranchId = isSuperuser ? bran_id : req.user?.bran_id;
    if (!isSuperuser && !scopedCompanyId) {
      return res.status(403).json({ resultCode: 403, message: 'User company is not assigned or does not match owner company' });
    }

     const [duplicateUsers] = await WaitTransition.promise().query<RowDataPacket[]>(
       'SELECT user_id FROM users WHERE username = ? AND company_id <=> ? AND bran_id <=> ? AND user_id <> ?',
       [username, scopedCompanyId ?? null, scopedBranchId ?? null, userId]
     );
     if (duplicateUsers.length > 0) {
       return res.status(409).json({
         resultCode: 409,
         message: serviceMessage.USER_ALREADY_EXIST
       });
     }

     const B_KEY = bcrypt.genSaltSync(10)
    const  NewPsd  =  bcrypt.hashSync(password,B_KEY)
    let scopeSql = '';
    const params: (string | number)[] = [username, NewPsd, role, updated_at, status, userId];
    if (!isSuperuser) {
      scopeSql += ' AND COMPANY_ID = ?';
      params.push(scopedCompanyId!);
      if (scopedBranchId) {
        scopeSql += ' AND BRAN_ID = ?';
        params.push(scopedBranchId);
      }
    }
    const sql = `UPDATE users SET USERNAME=?, PASSWORD=?, ROLE=?, UPDATED_AT=?, STATUS=? WHERE USER_ID = ?${scopeSql}`;
     const [result] = await WaitTransition.promise().query<ResultSetHeader>(sql,params)
     if (result.affectedRows < 1)
     {
       const [matchedUsers] = await WaitTransition.promise().query<RowDataPacket[]>(
         `SELECT user_id FROM users WHERE user_id = ?${scopeSql}`,
         [userId, ...params.slice(6)]
       );
       if (matchedUsers.length === 0) {
         return res.status(404).json({
           resultCode: 404,
           message: serviceMessage.USER_NOT_FOUND
         });
       }
     }
     return res.status(200).json({
      resultCode:200,
      message:serviceMessage.OPERATION_SUCESS
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


