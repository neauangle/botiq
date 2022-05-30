import * as nodemailer from "nodemailer";



//Note: to use gmail you have to enable less secure app access here: https://www.google.com/settings/security/lesssecureapps
export async function sendTextGmail({username, password, to, subject, text}){
    return sendEmail({host: 'smtp.gmail.com', username, password, to, subject, text});
}



export async function sendEmail({host, username, password, to, subject, text, html, port}) {
    const transport = {
        host,
        port, // (defaults to 587 if is secure is false or 465 if true)
        //secure: ,
        auth: {
            user: username,
            pass: password
        }
    };
    const transporter = nodemailer.createTransport(transport);
    return transporter.sendMail({
        from: username,
        to,
        subject,
        text, // plain text body
        html, // html body
    });
}