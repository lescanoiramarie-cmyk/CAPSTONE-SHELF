export const SUBADMIN_TERMS_VERSION = '2026-11-04-v1';

export default function SubAdminTermsContent({ content }) {
  if (typeof content === 'string' && content.trim()) {
    return content.trim().split(/\n\s*\n/).map((paragraph, index) => (
      <p key={`custom-subadmin-term-${index}`} className="whitespace-pre-line">{paragraph.trim()}</p>
    ));
  }
  return (
    <>
      <p>
        <strong>1. Scope and acknowledgment.</strong> These Terms and
        Conditions apply to your authorized staff account and use of SHELF.
        By selecting “I agree,” you confirm that you have read and will follow
        these requirements. Access is limited to the branch and responsibilities
        assigned to your account and may be changed or withdrawn by the
        institution. These requirements supplement, and do not replace, your
        employment, confidentiality, information-security, and records
        management obligations.
      </p>
      <p>
        <strong>2. Information you may access.</strong> Depending on your
        assigned duties, SHELF may show visitor names, email, telephone number
        or address; account, verification and QR-pass status; attendance
        records; book, inventory, borrowing, reservation, return, and fine
        records; community-book information; and feedback or messages.
        Authentication, access, and administrative actions may also be
        recorded in audit logs. Treat all non-public records as confidential,
        including information you learn from a screen, report, export, or
        conversation.
      </p>
      <p>
        <strong>3. Authorized use and confidentiality.</strong> Access or use
        personal information only when necessary for a specific assigned
        library task and only within your branch permissions. Do not browse
        records out of curiosity, access your own or another person’s records
        without a work reason, use information for personal benefit or
        discrimination, disclose it to unauthorized people, or use it for
        marketing or unrelated activities. Share the minimum necessary
        information only with authorized people through institution-approved
        channels. Verify recipients and purpose before sharing.
      </p>
      <p>
        <strong>4. Account and information security.</strong> Use your own
        account and keep passwords and verification codes private. Do not share
        accounts, leave an authenticated device unattended, bypass controls,
        or use unapproved devices, storage, messaging, or email for records.
        Lock the device when away and sign out when finished. Do not download,
        photograph, print, or retain records unless necessary for an authorized
        task and allowed by institutional policy; protect approved copies and
        securely dispose of them when no longer required. Make only accurate
        changes that fall within your authority and follow established
        verification procedures.
      </p>
      <p>
        <strong>5. Incidents and privacy requests.</strong> Immediately report
        suspected account compromise, lost devices or records, misdirected
        messages, unauthorized access or disclosure, or other privacy or
        security incidents to your supervisor and the institution’s designated
        privacy/security contact, using its incident procedure. Preserve
        relevant evidence as directed, do not conceal the incident or further
        share affected information, and do not investigate or notify external
        parties unless authorized. Refer visitor requests to access, correct,
        delete, or restrict information to the designated Data Protection
        Officer or privacy contact; do not promise an outcome or alter records
        outside the approved process.
      </p>
      <p>
        <strong>6. Records, monitoring, and retention.</strong> Use and
        retention of records must follow the institution’s approved retention
        schedule, records-management procedures, legal holds, and applicable
        law. Do not create unofficial copies or destroy or alter records to
        avoid review or retention requirements. SHELF may log access and
        administrative actions for security, audit, and service operations;
        those logs are restricted and retained under applicable policy.
      </p>
      <p>
        <strong>7. Applicable law and consequences.</strong> Handle personal
        information in accordance with Republic Act No. 10173, the Data
        Privacy Act of 2012, its Implementing Rules and Regulations, applicable
        National Privacy Commission issuances, institutional privacy and
        security policies, and your confidentiality obligations. SHELF uses
        access controls and database policies intended to restrict records to
        authorized users, but no online system can guarantee absolute security.
        Your confidentiality obligations continue after you sign out or your
        access ends. Violations may lead to access suspension, administrative
        or disciplinary action, and referral for legal action as permitted by
        institutional policy and applicable law.
      </p>
      <p>
        <strong>8. Contact and acknowledgment record.</strong> Follow your
        institution’s current privacy, incident-reporting, and records
        procedures. Ask your supervisor or designated Data Protection Officer
        for the official contact details and escalation route if you do not
        know them. When you accept these terms, SHELF records your authenticated
        staff account, staff identity and assigned branch as available in the
        staff profile, the terms version, and the acceptance date and time for
        compliance and audit purposes. Material changes require a new
        acknowledgment.
      </p>
    </>
  );
}
