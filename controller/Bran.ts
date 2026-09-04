import WaitTransition from '../db/dbconfigHelper.js';
import  type  { RowDataPacket } from 'mysql2';
import { serviceMessage } from "../utils/service.Message.js";
  import  type {Request , Response} from 'express';

  type  Status  = 'active' | 'inactive';
  interface  Branc  extends RowDataPacket    {
    bran_id: number,
    bran_name: string,
    bran_status:  Status,
    company_id: number
    created_at: string,
    updated_at: string,

  }

export const  getBranall = async (
  req: Request,
  res: Response
) => {
  try {
    const { search } = req.query;

    let sql = `
    SELECT  *  FROM branc

   
    `;

    const params: (string | number)[] = [];

    if (req.user?.user_role !== 'superuser') {
      if (!req.user?.company_id) {
        return res.status(403).json({ resultCode: 403, message: 'User company is not assigned' });
      }
      sql += ` WHERE company_id = ?`;
      params.push(req.user.company_id);
    }

    // // Search username
    if (
      typeof search === 'string' &&
      search.trim() !== ''
    ) {
      sql += ` ${req.user?.user_role === 'superuser' ? 'WHERE' : 'AND'} bran_name LIKE ?`;
      params.push(`${search.trim()}%`);
    }

    sql += ` ORDER BY bran_id  DESC`;


    const [rows] = await  WaitTransition
      .promise()
      .query<Branc[]>(sql, params);
   if(rows.length === 0) {
  return res.status(402).json({
     resultCode: 402,
     message:serviceMessage.DATA_NOT_FOUND
  })

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
 export  const  getBranID = async (req:Request,res:Response) => {
     const {bran_id} = req.params as unknown as  Branc ;
     if(!bran_id)  {
        return res.status(400).json({
            resultCode:400,
            message:  serviceMessage.ID_NOT_FOUND
        })
     }
     try
     
     {

  const isSuperuser = req.user?.user_role === 'superuser';
  const scopeSql = isSuperuser ? '' : ' AND company_id = ?';
  const params = isSuperuser ? [bran_id] : [bran_id, req.user?.company_id];
  const sql = `SELECT * FROM branc WHERE bran_id = ?${scopeSql}`;
  const [result] = await WaitTransition.promise().query<Branc[]>(sql, params);
        if( result.length === 0) {
          
          return res.status(404).json({
                resultCode:404,
                message:serviceMessage.DATA_NOT_FOUND
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
export const  Addbran  = async (req:Request, res:Response) => {
const  { bran_name,bran_status, created_at,company_id,updated_at }  = req.body as Branc;

console.log(bran_name)
console.log(bran_status)
console.log(created_at)
console.log(company_id)
console.log(updated_at)
if(!bran_name || !bran_status ||  !company_id || !created_at || !updated_at) {
  return res.status(402).json({
    resultCode:402,
    message: serviceMessage.DATA_NOT_EXIST
  })
}
  
  try{

     const sql   =  ` INSERT INTO branc (bran_name,bran_status,created_at,company_id ,updated_at) values(?,?,?,?,?)` ;
      const params = [ bran_name,bran_status,created_at,company_id,updated_at]
     const data  = await WaitTransition.promise().query(sql,params)
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
