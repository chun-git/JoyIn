import { Link } from 'react-router-dom';
import { Modal } from './Modal';

export function JoinHelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="報名與代報說明" onClose={onClose} className="join-help-sheet">
      <ul className="help-notes modal-help-list">
        <li>本人報名：每位 LINE 帳號每場活動只能本人報名一次。</li>
        <li>代報：可幫尚未開 JoyIn 的朋友報名，名單會標註代報者。</li>
        <li>取消：只能取消自己的本人報名，或自己建立的代報。</li>
        <li>候補：額滿且有開放候補時依加入順序排隊；有人取消正式名額時會自動遞補。</li>
      </ul>
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} autoFocus>
          關閉
        </button>
        <Link to="/help/join" className="btn secondary" onClick={onClose}>
          查看完整使用手冊
        </Link>
      </div>
    </Modal>
  );
}
