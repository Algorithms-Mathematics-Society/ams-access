import { type Dispatch, type SetStateAction } from "react";

export interface SsoModalProps {
  setShowSSOModal: Dispatch<SetStateAction<boolean>>;
}

export function SsoModal({ setShowSSOModal }: SsoModalProps) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sso-title" className="login-modal-bg">
      <div className="login-modal">
        <div className="login-modal-tag">Limited availability</div>
        <h3 id="sso-title" className="login-modal-title">
          Institution SSO is not enabled
        </h3>
        <p className="login-modal-body">
          Institution Single Sign-On is not available for this contest. Use the email and password
          assigned to you by your contest organizer to sign in.
        </p>
        <button type="button" onClick={() => setShowSSOModal(false)} className="login-modal-close">
          Close
        </button>
      </div>
    </div>
  );
}
