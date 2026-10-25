# Partial key matches also protect nested fields. Never log enquiry text,
# contact information, credentials, MFA secrets or financial references.
Rails.application.config.filter_parameters += [
  :passw, :email, :secret, :token, :_key, :crypt, :salt, :certificate, :otp,
  :ssn, :cvv, :cvc, :name, :phone, :company, :subject, :message, :body,
  :bank, :account_number, :account_name, :receipt, :recovery, :totp, :membership_import, :membership_csv, :member_reference, :registry_rows
]
