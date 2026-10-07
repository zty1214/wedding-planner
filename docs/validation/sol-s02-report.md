# S02 本地150人导出验收

日期：2026-10-07。基线：207a26762846b141a3e25dc01dd64ebe51834041。
独立工作树：/Users/baojie/.codex/worktrees/sol-s02-exports/wedding-planner。

## 范围与操作

仅新增验收脚本及本报告/实际文件；使用实际 ExportPanel、projectRepository、FrozenSeatingExport 与 XLSX 导出接口。虚构只读 transport 无云端连接，execute 会报 READ_ONLY_FIXTURE。使用本地4191端口，CUA独立IAB标签；未设置viewport、未操作主会话标签、未读取或复制凭证。

启动：`node scripts/fusion/review-sol-s02-exports.mjs`，访问 http://127.0.0.1:4191/__sol_s02_exports 。固定150人/15桌（每桌10人）、75间标间、2026-12-31及2027-01-01两晚。长姓名前两人分别欧阳司徒慕容长姓名验收 001/002；所有电话为00开头字符串。

通过实际界面依次下载宾客名单、住宿安排，生成座位图并点击下载PNG。CUA download waitForEvent超时，但文件实际存在Downloads；据实际落盘文件复制归档，而非将点击视为完成。原始三个文件名均包含云端已确认、r207及2026-10-07T06-55-25-393Z取样时间。

## 结果

- sol-s02-guests.xlsx：61741字节；151行（表头加150宾客）。SheetJS回读并逐一断言150姓名及150电话精确一致，长姓名及001/002后缀保留；电话00前导零完整。
- sol-s02-rooms.xlsx：36590字节；住宿明细76行，75房间字符串001至075；两列日期完整跨年。回读逐一断言房号，两个晚次各100入住人、75用房。首房长姓名001只在12-31、002只在01-01。
- 两个XLSX的Title为“S02纯虚构150人导出 · 云端已确认”；Subject/Comments包含云端已确认、核心版本207、项目/代次及同一取样时间。住宿导出按现有接口不包含电话，电话检查适用于名单。
- sol-s02-seating.png：960645字节；4368×2400。实际像素图检查15桌均完整、150座位全部显示，左栏15桌/150座位/150入座/150确认、云端已确认·r207及取样时间可读。桌名、普通姓名和数字后缀完整；超长姓名分多行且字体较小，可放大查看。未发现裁切或桌间重叠。追加原始尺寸查看（工具原始4368×2400输入，显示约4287×2356）：首桌两长姓名可逐字辨识为“欧阳司徒 / 慕容长姓 / 名验收 / 001”及对应002，四行均在座位圆内，未截断，未与邻座重叠。近100%像素阅读成立；整页缩略预览字体明显较小。

## 限制

XLSX验证是实际文件内容/单元格类型回读，不代表在Excel/Numbers中的列宽、打印分页视觉验收。PNG完整像素已查看；150座位一页缩略图中极长姓名阅读需放大，不声称所有姓名在任意手机预览尺寸均清晰。本包验证确认版本导出；草稿/恢复/权限/云端链路属于主会话其他任务。未修改业务导出代码。未push/deploy。

## 文件 SHA256

- sol-s02-guests.xlsx: `a94c08c94142faa9f7c37154ac498be39a32062b05b82af760a5320ee4661bda`
- sol-s02-rooms.xlsx: `62214db399eefc44497209651bfa191e677d0ee69199f25411920e303ea74ec0`
- sol-s02-seating.png: `c8aa8f2dbeeb43206a7dc1fb82e11c15e07e1b428ec0c952efe905d1243edddb`

## 可复现回读断言

在仓库根目录（使用已有xlsx依赖）执行：

```sh
node --input-type=module - <<'JS'
import XLSX from 'xlsx';import assert from 'node:assert/strict';
const p='docs/validation/sol-s02-';
const g=XLSX.readFile(p+'guests.xlsx'),r=XLSX.readFile(p+'rooms.xlsx');
const rows=XLSX.utils.sheet_to_json(g.Sheets['宾客名单'],{header:1});
assert.equal(rows.length,151);
for(let i=0;i<150;i++){
 assert.equal(rows[i+1][1],'00'+String(123456700+i));
 assert.equal(rows[i+1][0],i<2?'欧阳司徒慕容长姓名验收 '+String(i+1).padStart(3,'0'):'虚构宾客 '+String(i+1).padStart(3,'0'));
}
for(const w of [g,r]){
 assert.equal(w.Props.Title,'S02纯虚构150人导出 · 云端已确认');
 assert.match(w.Props.Subject,/核心版本 207/);
 assert.equal(w.Props.Subject,w.Props.Comments);
}
const rooms=XLSX.utils.sheet_to_json(r.Sheets['住宿明细'],{header:1});
assert.equal(rooms.length,76);
assert.deepEqual(rooms[0].slice(2,4),['2026-12-31','2027-01-01']);
for(let i=0;i<75;i++)assert.equal(rooms[i+1][0],String(i+1).padStart(3,'0'));
const counts=XLSX.utils.sheet_to_json(r.Sheets['每晚用房'],{header:1});
assert.equal(counts[1][4],100);assert.equal(counts[2][4],100);
console.log('PASS');
JS
```
