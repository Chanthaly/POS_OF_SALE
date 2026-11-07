
import type { Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import waitTransition from '../db/dbconfigHelper.js';
import { withTransaction } from '../dbconfig/configdb.js';
import { serviceMessage } from '../utils/service.Message.js'; 
import { genAccessJWT } from '../utils/JWTHelper.js'

import bcry  from 'bcryptjs'


 type Role  = 'user'|'admin'|'superuser'|'cashier'|'manager'|'staff'
 type  Status = 'active' | 'inactive'
type User = RowDataPacket & {
    user_id: number;
    username: string;
    password: string;
    role:Role
    created_at: string;
    status:Status
    bran_id: number,
    company_id: number | null,
    c_status: Status
};

export const LoginUser = async (req: Request, res: Response) => {
    const { username, password } = (req.body ?? {}) as Partial<User>
    if (!username || !password) {
        return res.status(401).json({
            resultCode: 401,
            message: serviceMessage.USER_NOTEXIT
        });
    }

    try {
        const sql = `
            SELECT u.*, c.c_status
            FROM users u
            LEFT JOIN company c ON c.company_id = u.company_id
            WHERE u.username = ?
            ORDER BY u.user_id DESC
        `;

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

        const matchingUsers = rows.filter((candidate) => bcry.compareSync(password, candidate.password));
        if (matchingUsers.length === 0) {
            return res.status(401).json({
                resultCode: 401,
                message: serviceMessage.INVALID_PASSWORD
            });
        }
        if (matchingUsers.length > 1) {
            return res.status(409).json({
                resultCode: 409,
                message: serviceMessage.MULTIPLE_USERS_MATCH_CREDENTIALS
            });
        }

        const user = matchingUsers[0];
        if (!user) {
            return res.status(404).json({
                resultCode: 404,
                message: serviceMessage.USER_NOT_FOUND
            });
        }

        if (user.status !== 'active') {
            return res.status(401).json({
                resultCode: 401,
                message: serviceMessage.USER_INACTIVE
            });
        }

        if( user.role  !== 'superuser') {
            if (user.company_id === null || user.bran_id === null) {
                return res.status(422).json({
                    resultCode: 422,
                    message: serviceMessage.USER_COMPANY_OR_BRANCH_NOT_ASSIGNED
                });
            }
           
        }
        if (user.role !== 'superuser' && user.c_status !== 'active') {
            return res.status(403).json({
                resultCode: 403,
                message: serviceMessage.COMPANY_INACTIVE
            });
        }

        const accToken = genAccessJWT({
            user_id: user.user_id,
            username: user.username,
            role: user.role,
            bran_id: user.bran_id,
            company_id: user.company_id,

        });

        return res.status(200).json({
            resultCode: 200,
            message: serviceMessage.SUCCESS,
            token: accToken,
            data: {
                user_ID: user.user_id,
                user_Name: user.username,
                user_role: user.role,
                Bran_id: user.bran_id,
                Company_id: user.company_id,
            }
        });
    } catch (err) {
        console.error('Login error:', err);

        return res.status(500).json({
            resultCode: 500,
            message: serviceMessage.DATABASE_ERROR
        });
    }
};
export const RegisterUser  = async (req:Request, res:Response) => {
const  {username,password, role ,created_at, company_id: bodyCompanyId, bran_id: bodyBranchId}  = (req.body ?? {}) as Partial<User>
console.log(username)
console.log(password)
console.log(role)
console.log(created_at)
console.log(bodyCompanyId)
console.log(bodyBranchId)

if(!username || !password || !created_at || !role || !['user','admin','superuser','manager','staff','cashier'].includes(role)) {
  return res.status(402).json({
    resultCode:402,
    message: serviceMessage.USER_NOTEXIT
  })
}
              //  ສິດໃນການເພີ່ມພະນັກງານ
            const requesterRole = req.user?.user_role;
            if (requesterRole !== 'admin'  && requesterRole !== 'superuser' && requesterRole !=='manager') {
                return res.status(403).json({
                    resultCode: 403,
                    message: serviceMessage.ONLY_ADMIN_OR_SUPERUSER_CAN_REGISTER_USERS,
                });
            }

            // A superuser is the global system owner and may choose any company/branch.
            // A null branch means the user can work with every branch in that company.
            const company_id = requesterRole === 'superuser' ? (bodyCompanyId ?? null) : req.user?.company_id;
            const bran_id = requesterRole === 'superuser' || requesterRole === 'admin'
                ? (bodyBranchId ?? null)
                : req.user?.bran_id;
            console.log(company_id)
            console.log(bran_id)
            if (
                (company_id !== null && (typeof company_id !== 'number' || !Number.isInteger(company_id) || company_id <= 0)) ||
                (role !== 'superuser' && company_id === null) ||
                (bran_id !== null && (typeof bran_id !== 'number' || !Number.isInteger(bran_id) || bran_id <= 0))
            ) {
                return res.status(401).json({
                    resultCode: 401,
                    message: serviceMessage.UNAUTHORIZED,
                });
            }
  try{
        if (bran_id !== null && company_id !== null) {
            const [branchRows] = await waitTransition.promise().query<RowDataPacket[]>(
                'SELECT bran_id FROM branc WHERE bran_id = ? AND company_id = ?',
                [bran_id, company_id]
            );
            if (!branchRows.length) {
                return res.status(400).json({ resultCode: 400, message: serviceMessage.BRANCH_DOES_NOT_BELONG_TO_OWNER_COMPANY });
            }
        }
                if (bran_id !== null && company_id === null) {
                    return res.status(400).json({ resultCode: 400, message: serviceMessage.BRANCH_REQUIRES_COMPANY });
                }
     const B_KEY = bcry.genSaltSync(10)
    const  NewPsd  = bcry.hashSync(password,B_KEY)
     const sql   =  ` INSERT INTO users (username,password,role,created_at,company_id,bran_id) values(?,?,?,?,?,?)` ;
      const params = [username,NewPsd,role,created_at, company_id,bran_id]
    const data = await withTransaction((connection) => connection.query(sql, params))
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
