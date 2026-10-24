import type {PoolClient} from 'pg';
export type AnnouncementStatus='draft'|'published'|'archived';
export interface AnnouncementInput {title:string;body:string;category:'important'|'event'|'general'}
export interface AnnouncementView extends AnnouncementInput {id:string;tribeId:string;authorMembershipId:string;status:AnnouncementStatus;publishedAt:string|null;createdAt:string}
export interface AnnouncementList {limit:number;offset:number;status?:AnnouncementStatus;search?:string}
const columns=`id,tribe_id AS "tribeId",author_membership_id AS "authorMembershipId",title,body,category,status,
 to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "publishedAt",
 to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"`;
export class AnnouncementRepository {
 constructor(private readonly db:PoolClient) {}
 async list(tribeId:string,query:AnnouncementList) {
  return (await this.db.query<AnnouncementView>(`SELECT ${columns} FROM announcements WHERE tribe_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR strpos(lower(title),lower($3))>0 OR strpos(lower(body),lower($3))>0) ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,[tribeId,query.status??null,query.search??null,query.limit,query.offset])).rows;
 }
 async lock(tribeId:string,id:string) {return (await this.db.query<AnnouncementView>(`SELECT ${columns} FROM announcements WHERE tribe_id=$1 AND id=$2 FOR UPDATE`,[tribeId,id])).rows[0]??null;}
 async create(tribeId:string,author:string,input:AnnouncementInput) {
  return (await this.db.query<AnnouncementView>(`INSERT INTO announcements(tribe_id,author_membership_id,title,body,category) VALUES($1,$2,$3,$4,$5) RETURNING ${columns}`,[tribeId,author,input.title,input.body,input.category])).rows[0]!;
 }
 async edit(tribeId:string,id:string,input:Partial<AnnouncementInput>) {
  return (await this.db.query<AnnouncementView>(`UPDATE announcements SET title=COALESCE($3,title),body=COALESCE($4,body),category=COALESCE($5,category) WHERE tribe_id=$1 AND id=$2 RETURNING ${columns}`,[tribeId,id,input.title??null,input.body??null,input.category??null])).rows[0]!;
 }
 async transition(tribeId:string,id:string,status:'published'|'archived') {
  return (await this.db.query<AnnouncementView>(`UPDATE announcements SET status=$3,published_at=CASE WHEN $3='published' THEN clock_timestamp() ELSE published_at END WHERE tribe_id=$1 AND id=$2 RETURNING ${columns}`,[tribeId,id,status])).rows[0]!;
 }
}
