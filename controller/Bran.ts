import WaitTransition from '../db/dbconfigHelper.js';
import  type  { RowDataPacket } from 'mysql2';
import type { ResultSetHeader } from 'mysql2';
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
    village: string | null,
    district: string | null,
    province: string | null,
    address: string | null,
    latitude: number | null,
    longitude: number | null,

  }

type BranchLocation = Pick<Branc, 'village' | 'district' | 'province' | 'address' | 'latitude' | 'longitude'>;

const normalizeLocation = (body: Partial<Branc>): BranchLocation => ({
  village: body.village?.trim() || null,
  district: body.district?.trim() || null,
  province: body.province?.trim() || null,
  address: body.address?.trim() || null,
  latitude: body.latitude ?? null,
  longitude: body.longitude ?? null,
});

const hasValidCoordinates = ({ latitude, longitude }: BranchLocation) =>
  (latitude === null || (Number.isFinite(latitude) && latitude >= -90 && latitude <= 90)) &&
  (longitude === null || (Number.isFinite(longitude) && longitude >= -180 && longitude <= 180));

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

    const isSuperuser = req.user?.user_role === 'superuser';
    if (!isSuperuser && !req.user?.company_id) {
      return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_COMPANY_NOT_ASSIGNED });
    }
    if (!isSuperuser) {
      sql += ` WHERE company_id = ?`;
      params.push(req.user!.company_id!);
      if (req.user?.user_role === 'manager') {
        sql += ` AND bran_id = ?`;
        params.push(req.user!.bran_id!);
      }
    }

    // // Search username
    if (
      typeof search === 'string' &&
      search.trim() !== ''
    ) {
      sql += `${isSuperuser ? ' WHERE' : ' AND'} bran_name LIKE ?`;
      params.push(`${search.trim()}%`);
    }

    sql += ` ORDER BY bran_id  DESC`;


    const [rows] = await  WaitTransition
      .promise()
      .query<Branc[]>(sql, params);
   if(rows.length === 0) {
  return res.status(404).json({
     resultCode: 404,
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

  if (req.user?.user_role !== 'superuser' && !req.user?.company_id) {
    return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_COMPANY_NOT_ASSIGNED });
  }
  if (req.user?.user_role === 'manager' && Number(bran_id) !== Number(req.user?.bran_id)) {
    return res.status(403).json({ resultCode: 403, message: serviceMessage.BRANCH_ACCESS_DENIED });
  }
  const scopeSql = req.user?.user_role === 'superuser' ? '' : ' AND company_id = ?';
  const params = req.user?.user_role === 'superuser' ? [bran_id] : [bran_id, req.user!.company_id!];
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
const  { bran_name,bran_status, created_at,company_id: bodyCompanyId}  = req.body as Branc;
const location = normalizeLocation(req.body as Partial<Branc>);
const isSuperuser = req.user?.user_role === 'superuser';
const company_id = isSuperuser ? bodyCompanyId : req.user?.company_id;

if(!bran_name?.trim() || !bran_status || !company_id || !created_at || !hasValidCoordinates(location) || (!isSuperuser && bodyCompanyId !== undefined && bodyCompanyId !== company_id)) {
  return res.status(402).json({
    resultCode:402,
    message: serviceMessage.DATA_NOT_EXIST
  })
}
  
  try{

     const sql = `
       INSERT INTO branc (
         bran_name, bran_status, created_at, company_id,
         village, district, province, address, latitude, longitude
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     `;
      const params = [
        bran_name.trim(), bran_status, created_at, company_id,
        location.village, location.district, location.province, location.address,
        location.latitude, location.longitude,
      ];
      const [data] = await WaitTransition.promise().query<ResultSetHeader>(sql, params);
     if(data.affectedRows === 0)
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

export const Editbran = async (req: Request, res: Response) => {
  const branchId = Number(req.params.bran_id);
  const { bran_name, bran_status, updated_at } = req.body as Partial<Branc>;
  const location = normalizeLocation(req.body as Partial<Branc>);
  const isSuperuser = req.user?.user_role === 'superuser';

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });
  }
  if (!bran_name?.trim() || !bran_status || !updated_at || !hasValidCoordinates(location)) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.DATA_NOT_EXIST });
  }
  if (!isSuperuser && !req.user?.company_id) {
    return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_COMPANY_NOT_ASSIGNED });
  }
  if (req.user?.user_role === 'manager' && branchId !== Number(req.user.bran_id)) {
    return res.status(403).json({ resultCode: 403, message: serviceMessage.BRANCH_ACCESS_DENIED });
  }

  try {
    const sql = `
      UPDATE branc
      SET bran_name = ?, bran_status = ?, updated_at = ?,
          village = ?, district = ?, province = ?, address = ?,
          latitude = ?, longitude = ?
      WHERE bran_id = ?${isSuperuser ? '' : ' AND company_id = ?'}
    `;
    const params: (string | number | null)[] = [
      bran_name.trim(), bran_status, updated_at,
      location.village, location.district, location.province, location.address,
      location.latitude, location.longitude, branchId,
    ];
    if (!isSuperuser) params.push(req.user!.company_id!);

    const [data] = await WaitTransition.promise().query<ResultSetHeader>(sql, params);
    if (data.affectedRows === 0) {
      return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    }
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    console.error('Edit branch error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, err });
  }
};
