import type {Request, Response} from 'express'
import {serviceMessage } from '../utils/service.Message.js'
import WaitTransition from '../db/dbconfigHelper.js';
import type { RowDataPacket } from 'mysql2';
import  type { ResultSetHeader } from "mysql2";


export const getCompanys = async (
  req: Request,
  res: Response
) => {
  try {
    const { search } = req.query;

    let sql = `
    SELECT  *  FROM company

   
    `;

    const params: string[] = [];

    // // Search username
    if (
      typeof search === 'string' &&
      search.trim() !== ''
    ) {
      sql += ` WHERE   company_name LIKE ?`;
      params.push(`${search.trim()}%`);
    }

    sql += ` ORDER BY company_id  DESC`;

    const [rows] = await WaitTransition
      .promise()
      .query(sql, params);
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
type  CompanyID  = {
  company_id: number,
}
 type Status = 'active' | 'inactive'
type CompanyData   = RowDataPacket  & {
   company_name: string,
   c_status:   Status,
    created_at: string,
    updated_at: string,
     companyID: CompanyID
}
 export  const  getCompanyID = async (req:Request,res:Response) => {
     const {company_id} = req.params as unknown as CompanyID;
     if(!company_id)  {
        return res.status(400).json({
            resultCode:400,
            message:  serviceMessage.ID_NOT_FOUND
        })
     }
     try
     
     {


        const  result  = await WaitTransition.promise().query("SELECT * FROM company WHERE company_id = ?",[company_id]);
        if(!result || result.length <= 0) {
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
export const  AddCompanyDATA  = async (req:Request, res:Response) => {
const  { company_name,c_status,created_at,updated_at }  = req.body as CompanyData;

if(!company_name || !c_status || !created_at || !updated_at) {
  return res.status(402).json({
    resultCode:402,
    message: serviceMessage.DATA_NOT_EXIST
  })
}
  
  try{

     const sql   =  ` INSERT INTO company (company_name,c_status,created_at,updated_at) values(?,?,?,?)` ;
      const params = [ company_name,c_status,created_at,updated_at]
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
// export const EditCPN = async (req:Request, res:Response) => {
//   const {company_id } = req.params  as CompanyData
// const  {company_name,c_status, created_at,updated_at}  = req.body as  CompanyData
// if(!company_id) {
//   return res.status(402).json({
//     resultCode:402,
//     message: serviceMessage.ID_NOT_FOUND
//   })
// }
// if(!company_name || !c_status || !created_at || !updated_at) {
//   return  res.status(401).json({
//     resultCode:402,
//     message: serviceMessage.DATA_NOT_EXIST
//   })
// }
  
//   try{

   
//      const sql   =  ` UPDATE company SET COMPANY_NAME=?,C_STATUS=?,CREATED_AT=?,UPDATED_AT=? WHERE COMPANY_ID = ?` ;
//       const params = [company_name,c_status,created_at,updated_at,company_id]
//      const [data] = await WaitTransition.promise().query(sql,params)
//      if(! data || data.affectedRows <= 1)
//      {
//       return res.status(402).json({
//         resultCode:401,
//         message:serviceMessage.OPERATION_FAILE
//       })
//      }
//      res.status(201).json({
//       resultCode:201,
//       meesage:serviceMessage.OPERATION_SUCESS
//      })

//   }catch(err)
//   {
//     console.error("err=>",err)
//    return res.status(500).json({
//     resultCode:500,
//     message:serviceMessage.SERVER_ERROR,err
//    })
//   }



export const EditCPN = async (req: Request, res: Response) => {
  const { company_id } = req.params as CompanyData;

  const {
    company_name,
    c_status,
    created_at,
    updated_at
  } = req.body as CompanyData;

  if (!company_id) {
    return res.status(402).json({
      resultCode: 402,
      message: serviceMessage.ID_NOT_FOUND
    });
  }

  if (!company_name || !c_status || !created_at || !updated_at) {
    return res.status(401).json({
      resultCode: 402,
      message: serviceMessage.DATA_NOT_EXIST
    });
  }

  try {
    const sql = `
      UPDATE company
      SET COMPANY_NAME = ?,
          C_STATUS = ?,
          CREATED_AT = ?,
          UPDATED_AT = ?
      WHERE COMPANY_ID = ?
    `;

    const params = [
      company_name,
      c_status,
      created_at,
      updated_at,
      company_id
    ];

    const [data] = await WaitTransition
      .promise()
      .query<ResultSetHeader>(sql, params);

    if (data.affectedRows === 0) {
      return res.status(402).json({
        resultCode: 401,
        message: serviceMessage.OPERATION_FAILE
      });
    }

    return res.status(200).json({
      resultCode: 200,
      message: serviceMessage.OPERATION_SUCESS
    });

  } catch (err) {
    console.error("err =>", err);

    return res.status(500).json({
      resultCode: 500,
      message: serviceMessage.SERVER_ERROR,
      err
    });
  }
};