#!/usr/bin/env python3
"""
Build synthetic Indian legal document fixtures for the docparse test suite.

Two flavours per document where it matters:
  *.text.pdf  — a real text layer, exercising the fast path
  *.scan.pdf  — rasterised, rotated, noised and JPEG-degraded, exercising OCR

The documents are invented but the FORMS are faithful: the field labels, the
statutory phrasing, the party arrays and the identifier shapes are what real
Indian filings carry. All names, numbers and facts are fictional.
"""

import os, random, subprocess, sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageFilter

random.seed(20260826)          # deterministic fixtures
HERE = os.path.dirname(os.path.abspath(__file__))
W, H = A4

FONTS = {
    "deva": "/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf",
    "taml": "/usr/share/fonts/truetype/lohit-tamil/Lohit-Tamil.ttf",
    "telu": "/usr/share/fonts/truetype/lohit-telugu/Lohit-Telugu.ttf",
    "beng": "/usr/share/fonts/truetype/lohit-bengali/Lohit-Bengali.ttf",
}
for name, path in list(FONTS.items()):
    if os.path.exists(path):
        pdfmetrics.registerFont(TTFont(f"Ind-{name}", path))
    else:
        print(f"  ! missing font for {name}: {path}", file=sys.stderr)
        FONTS.pop(name)


def draw(c, lines, x=54, y=None, leading=15, size=10.5, font="Helvetica"):
    """Draw a list of (text, opts) or plain strings, returning the final y."""
    if y is None:
        y = H - 60
    for item in lines:
        if item is None:
            y -= leading
            continue
        if isinstance(item, tuple):
            text, opts = item
        else:
            text, opts = item, {}
        f = opts.get("font", font)
        s = opts.get("size", size)
        indent = opts.get("indent", 0)
        centre = opts.get("centre", False)
        c.setFont(f, s)
        if centre:
            c.drawCentredString(W / 2, y, text)
        else:
            c.drawString(x + indent, y, text)
        y -= opts.get("leading", leading)
        if y < 60:
            c.showPage()
            y = H - 60
    return y


# ---------------------------------------------------------------------------
def fir():
    """Bilingual FIR, CrPC s.154 / BNSS s.173 form."""
    path = os.path.join(HERE, "fir.text.pdf")
    c = canvas.Canvas(path, pagesize=A4)
    dv = "Ind-deva" if "deva" in FONTS else "Helvetica"
    draw(c, [
        ("FIRST INFORMATION REPORT", {"font": "Helvetica-Bold", "size": 13, "centre": True}),
        ("प्रथम सूचना रिपोर्ट", {"font": dv, "size": 12, "centre": True}) if dv != "Helvetica" else None,
        ("(Under Section 154 Cr.P.C. / Section 173 BNSS)", {"size": 9, "centre": True}),
        None,
        ("1.  District: New Delhi        P.S. Connaught Place        Year: 2024", {}),
        ("2.  FIR No. 0123/2024                          Date: 12/03/2024", {}),
        ("3.  Acts & Sections:  u/s 420, 468, 471 r/w 34 IPC", {}),
        ("4.  Occurrence of Offence: Day Tuesday  Date from 10/03/2024  Date to 11/03/2024", {}),
        ("5.  Information received at P.S.: Time 09:45 hrs   G.D. No. 0045", {}),
        ("6.  Type of Information: Written", {}),
        ("7.  Place of Occurrence: Shop No. 14, Block B, Connaught Place, New Delhi - 110001", {}),
        ("    Beat No. 07     Distance from P.S.: 1.2 km", {}),
        None,
        ("8.  Complainant / Informant:", {"font": "Helvetica-Bold"}),
        ("    Name: Shri Rajesh Kumar Verma", {}),
        ("    Father's / Husband's Name: S/o Late Shri Mohan Lal Verma", {}),
        ("    Date of Birth / Age: aged about 47 years        Nationality: Indian", {}),
        ("    Occupation: Businessman", {}),
        ("    Address: B-45, Second Floor, Karol Bagh, New Delhi - 110005", {}),
        ("    Mobile: 9876543210        Email: rajesh.verma@example.in", {}),
        ("    Aadhaar No.: 2345 6789 0123        PAN: ABCPV1234E", {}),
        None,
        ("9.  Details of Accused:", {"font": "Helvetica-Bold"}),
        ("    A-1  Sunil Kumar Bansal, S/o Shri Prem Bansal, aged about 39 years,", {}),
        ("         R/o C-12, Lajpat Nagar-II, New Delhi - 110024. Mobile: 9812345678", {}),
        ("    A-2  Smt. Kavita Bansal, W/o Sunil Kumar Bansal, aged about 35 years,", {}),
        ("         R/o C-12, Lajpat Nagar-II, New Delhi - 110024", {}),
        ("    A-3  M/s Bansal Trading Company Pvt. Ltd., through its Director,", {}),
        ("         Registered Office: 88, Nehru Place, New Delhi. CIN: U51909DL2015PTC280456", {}),
        None,
        ("10. Particulars of properties involved:", {"font": "Helvetica-Bold"}),
        ("    Cash and goods valued at Rs. 24,50,000/- (Rupees Twenty Four Lakh Fifty", {}),
        ("    Thousand only). Cheque No. 456789 dated 05/03/2024 drawn on", {}),
        ("    State Bank of India, Connaught Place Branch, IFSC: SBIN0000691,", {}),
        ("    A/c No. 30124567890, returned unpaid for insufficient funds.", {}),
        None,
        ("11. Witnesses:", {"font": "Helvetica-Bold"}),
        ("    PW-1  Shri Anil Sharma, S/o Shri Ram Sharma, aged 52 years,", {}),
        ("          R/o A-9, Paharganj, New Delhi. Mobile: 9911223344", {}),
        ("    PW-2  Smt. Meena Devi, W/o Shri Anil Sharma, aged 48 years", {}),
        ("    PW-3  Shri Vikram Singh, Accountant, M/s Verma Enterprises", {}),
        None,
        ("12. Brief facts: The complainant states that between 10/03/2024 and", {}),
        ("    11/03/2024 the accused persons, in furtherance of common intention,", {}),
        ("    dishonestly induced the complainant to deliver goods worth", {}),
        ("    Rs. 24,50,000/- against a forged undertaking and a cheque which was", {}),
        ("    dishonoured. Investigation is being taken up.", {}),
        None,
        ("13. Action taken: Since the above information reveals commission of", {}),
        ("    offence(s) u/s 420, 468, 471 r/w 34 IPC, case registered and", {}),
        ("    investigation taken up by SI Ramesh Chand, Belt No. 1122.", {}),
        None,
        ("    Signature of Officer in Charge, Police Station Connaught Place", {"size": 9}),
        ("    Name: Inspector Devendra Pal Singh        Rank: SHO", {"size": 9}),
    ])
    c.save()
    return path


def judgement():
    """High Court criminal appeal judgement with citations and a disposition."""
    path = os.path.join(HERE, "judgement.text.pdf")
    c = canvas.Canvas(path, pagesize=A4)
    draw(c, [
        ("IN THE HIGH COURT OF DELHI AT NEW DELHI", {"font": "Helvetica-Bold", "size": 12, "centre": True}),
        ("CRIMINAL APPELLATE JURISDICTION", {"size": 10, "centre": True}),
        None,
        ("Neutral Citation No. 2024:DHC:4512-DB", {"size": 9, "centre": True}),
        None,
        ("CRL.A. No. 567 of 2023", {"font": "Helvetica-Bold"}),
        ("CNR No.: DLHC010045672023", {"size": 9}),
        None,
        ("SUNIL KUMAR BANSAL                                       ... Appellant", {}),
        ("Through: Mr. A. K. Sharma, Senior Advocate with", {"size": 9, "indent": 40}),
        ("Mr. Pranav Mehta, Advocate, Enrolment No. D/1234/2015", {"size": 9, "indent": 40}),
        None,
        ("                              Versus", {"font": "Helvetica-Bold"}),
        None,
        ("STATE (NCT OF DELHI)                                     ... Respondent", {}),
        ("Through: Ms. Ritu Bansal, Additional Public Prosecutor", {"size": 9, "indent": 40}),
        None,
        ("CORAM: HON'BLE MR. JUSTICE R. K. GAUBA", {}),
        ("       HON'BLE MS. JUSTICE ANITA NARAYAN", {}),
        None,
        ("Reserved on: 12th July, 2024", {"size": 9}),
        ("Pronounced on: 26th August, 2024", {"size": 9}),
        None,
        ("JUDGMENT", {"font": "Helvetica-Bold", "centre": True}),
        None,
        ("R. K. GAUBA, J.", {"font": "Helvetica-Bold"}),
        None,
        ("1.  This appeal under Section 374(2) Cr.P.C. is directed against the", {}),
        ("    judgment dated 15/09/2023 passed by the learned Additional Sessions", {}),
        ("    Judge, Patiala House Courts, New Delhi in S.C. No. 112/2021 arising", {}),
        ("    out of FIR No. 0123/2024, P.S. Connaught Place, convicting the", {}),
        ("    appellant u/s 420 and 468 IPC and sentencing him to rigorous", {}),
        ("    imprisonment for five years with a fine of Rs. 2,00,000/-.", {}),
        None,
        ("2.  Learned counsel for the appellant relied upon (2019) 4 SCC 512 and", {}),
        ("    AIR 2015 SC 2214 to contend that the requirement of Section 468 IPC", {}),
        ("    was not satisfied. Reliance was also placed on 2021 Cri LJ 998.", {}),
        None,
        ("3.  The prosecution examined PW-1 Anil Sharma and PW-3 Vikram Singh.", {}),
        ("    The document at Ex. P-4 was proved through the certificate under", {}),
        ("    Section 65B of the Indian Evidence Act.", {}),
        None,
        ("4.  Having considered the material on record, we are of the view that", {}),
        ("    the finding of guilt under Section 420 IPC is unassailable. However,", {}),
        ("    the conviction under Section 468 IPC cannot be sustained for want of", {}),
        ("    proof of the making of a false document.", {}),
        None,
        ("5.  Accordingly, the appeal is partly allowed. The conviction under", {}),
        ("    Section 468 IPC is set aside. The conviction under Section 420 IPC is", {}),
        ("    maintained but the sentence is reduced to three years rigorous", {}),
        ("    imprisonment. The fine of Rs. 2,00,000/- is maintained and shall be", {}),
        ("    paid within 60 days. The appellant shall surrender within 30 days.", {}),
        None,
        ("6.  A copy of this judgment be sent to the trial court and to the", {}),
        ("    Superintendent, Central Jail Tihar, for compliance.", {}),
        None,
        ("                                            R. K. GAUBA, J.", {"indent": 220}),
        ("                                            ANITA NARAYAN, J.", {"indent": 220}),
        ("AUGUST 26, 2024", {}),
    ])
    c.save()
    return path


def notice_138():
    """Statutory demand notice under s.138 NI Act — the three-link chain."""
    path = os.path.join(HERE, "notice138.text.pdf")
    c = canvas.Canvas(path, pagesize=A4)
    draw(c, [
        ("REGISTERED A.D. / SPEED POST", {"font": "Helvetica-Bold", "size": 9}),
        None,
        ("LEGAL NOTICE UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881",
         {"font": "Helvetica-Bold", "size": 11, "centre": True}),
        None,
        ("Dated: 20th April, 2024", {}),
        None,
        ("To,", {}),
        ("Shri Mahesh Chandra Agarwal,", {}),
        ("S/o Shri Ratan Lal Agarwal,", {}),
        ("Proprietor, M/s Agarwal Steel Traders,", {}),
        ("Plot No. 22, Industrial Area Phase-II, Ludhiana, Punjab - 141003", {}),
        ("Mobile: 9814567890", {}),
        None,
        ("Sir,", {}),
        None,
        ("Under instructions from and on behalf of my client M/s Sunrise Metals", {}),
        ("Private Limited, having its registered office at 401, Sector 18, Gurugram,", {}),
        ("Haryana - 122015 (CIN: U27100HR2012PTC046789, GSTIN: 06AABCS1234C1Z1),", {}),
        ("I serve upon you this notice as under:", {}),
        None,
        ("1.  That you purchased steel goods from my client and in discharge of your", {}),
        ("    legally enforceable liability issued Cheque No. 745812 dated", {}),
        ("    15/03/2024 for Rs. 18,75,000/- (Rupees Eighteen Lakh Seventy Five", {}),
        ("    Thousand only) drawn on Punjab National Bank, Ludhiana Branch,", {}),
        ("    IFSC: PUNB0123400, A/c No. 004561230078.", {}),
        None,
        ("2.  That the said cheque on presentation was returned unpaid by the", {}),
        ("    banker vide Return Memo dated 08/04/2024 with the remark", {}),
        ('    "insufficient funds".', {}),
        None,
        ("3.  That my client received intimation of the said dishonour on", {}),
        ("    10/04/2024.", {}),
        None,
        ("4.  You are hereby called upon to pay the said sum of Rs. 18,75,000/-", {}),
        ("    within 15 days of receipt of this notice, failing which my client", {}),
        ("    shall be constrained to initiate proceedings under Section 138 read", {}),
        ("    with Section 142 of the Negotiable Instruments Act, 1881 before the", {}),
        ("    competent Court of the Judicial Magistrate at Gurugram, besides a", {}),
        ("    civil suit for recovery, entirely at your risk and cost.", {}),
        None,
        ("A copy of this notice is retained in my office for record and further", {}),
        ("necessary action.", {}),
        None,
        ("                                          Yours faithfully,", {"indent": 200}),
        ("                                          (SANJAY KAPOOR)", {"indent": 200}),
        ("                                          Advocate", {"indent": 200}),
        ("                                          Enrolment No. P/2233/2009", {"indent": 200}),
        ("                                          Punjab & Haryana Bar Council", {"indent": 200}),
        ("                                          Mobile: 9878001122", {"indent": 200}),
    ])
    c.save()
    return path


def bail_petition():
    """Anticipatory bail application under CrPC 438 / BNSS 482."""
    path = os.path.join(HERE, "bail.text.pdf")
    c = canvas.Canvas(path, pagesize=A4)
    draw(c, [
        ("IN THE COURT OF THE DISTRICT AND SESSIONS JUDGE, PUNE",
         {"font": "Helvetica-Bold", "size": 12, "centre": True}),
        None,
        ("Criminal Bail Application No. 1450 of 2024", {"font": "Helvetica-Bold", "centre": True}),
        ("(Under Section 482 of the Bharatiya Nagarik Suraksha Sanhita, 2023)", {"size": 9, "centre": True}),
        None,
        ("Sandeep Ashok Kulkarni,", {}),
        ("S/o Shri Ashok Ramchandra Kulkarni,", {}),
        ("aged about 41 years, Occupation: Service,", {}),
        ("R/o Flat 704, Shivneri Apartments, Kothrud, Pune - 411038.", {}),
        ("Mobile: 9822011223                          ... Applicant / Accused", {}),
        None,
        ("                              Versus", {"font": "Helvetica-Bold"}),
        None,
        ("The State of Maharashtra,", {}),
        ("through Police Inspector, Kothrud Police Station, Pune", {}),
        ("                                            ... Respondent", {}),
        None,
        ("MOST RESPECTFULLY SHOWETH:", {"font": "Helvetica-Bold"}),
        None,
        ("1.  That Crime No. 289/2024 has been registered at Police Station", {}),
        ("    Kothrud, Pune for offences punishable u/s 406, 420 r/w 34 of the", {}),
        ("    Indian Penal Code on the complaint of one Shri Prakash Joshi.", {}),
        None,
        ("2.  That the applicant apprehends arrest at the hands of the", {}),
        ("    Investigating Officer and therefore approaches this Hon'ble Court", {}),
        ("    under Section 482 BNSS for anticipatory bail.", {}),
        None,
        ("3.  That the alleged transaction is purely civil in nature, arising out", {}),
        ("    of a partnership dispute in respect of which Special Civil Suit", {}),
        ("    No. 342/2023 is already pending before the Civil Judge Senior", {}),
        ("    Division, Pune.", {}),
        None,
        ("4.  That the applicant is a permanent resident of Pune, has deep roots", {}),
        ("    in society, is not a previous convict, and undertakes to cooperate", {}),
        ("    with the investigation and to abide by all conditions imposed.", {}),
        None,
        ("5.  That the applicant is prepared to furnish a personal bond of", {}),
        ("    Rs. 50,000/- with one solvent surety of the like amount.", {}),
        None,
        ("PRAYER", {"font": "Helvetica-Bold", "centre": True}),
        None,
        ("It is therefore most humbly prayed that this Hon'ble Court may be", {}),
        ("pleased to direct that in the event of arrest of the applicant in", {}),
        ("connection with Crime No. 289/2024 of Police Station Kothrud, Pune,", {}),
        ("he be released on bail on such terms as this Hon'ble Court deems fit,", {}),
        ("and to grant such other relief as the nature of the case may require.", {}),
        None,
        ("Pune                                    Advocate for the Applicant", {}),
        ("Dated: 05/07/2024                       Smt. Vaishali Deshpande", {}),
        ("                                        Enrolment No. MAH/5678/2010", {}),
        None,
        ("VERIFICATION", {"font": "Helvetica-Bold"}),
        ("I, Sandeep Ashok Kulkarni, the applicant above named, do hereby verify", {}),
        ("that the contents of paragraphs 1 to 5 are true to my knowledge.", {}),
        ("Verified at Pune on this 5th day of July, 2024.", {}),
    ])
    c.save()
    return path


def sale_deed():
    """Registered sale deed — property, consideration, survey numbers."""
    path = os.path.join(HERE, "saledeed.text.pdf")
    c = canvas.Canvas(path, pagesize=A4)
    draw(c, [
        ("DEED OF ABSOLUTE SALE", {"font": "Helvetica-Bold", "size": 13, "centre": True}),
        None,
        ("This Deed of Absolute Sale is made and executed on this 15th day of", {}),
        ("August, 2024 at Bengaluru.", {}),
        None,
        ("BETWEEN", {"font": "Helvetica-Bold", "centre": True}),
        None,
        ("Smt. Lakshmi Narayanaswamy, W/o Late Shri K. Narayanaswamy, aged about", {}),
        ("62 years, R/o No. 45, 4th Cross, Jayanagar 3rd Block, Bengaluru - 560011,", {}),
        ("PAN: AFGPL5678K, Aadhaar No.: 4567 8901 2345", {}),
        ("                                        ... hereinafter the VENDOR", {}),
        None,
        ("AND", {"font": "Helvetica-Bold", "centre": True}),
        None,
        ("M/s Greenfield Realty LLP, a limited liability partnership having its", {}),
        ("registered office at No. 12, MG Road, Bengaluru - 560001,", {}),
        ("LLPIN: AAB-1234, PAN: AAEFG9012M, represented by its Designated Partner", {}),
        ("Shri Arun Prakash, DIN: 07654321", {}),
        ("                                     ... hereinafter the PURCHASER", {}),
        None,
        ("WHEREAS the Vendor is the absolute owner of the property more fully", {}),
        ("described in the Schedule hereunder, having acquired the same under", {}),
        ("Sale Deed bearing Document No. 4521/2005 of Book-I registered before", {}),
        ("the Sub-Registrar, Jayanagar, Bengaluru;", {}),
        None,
        ("AND WHEREAS the Vendor has agreed to sell and the Purchaser has agreed", {}),
        ("to purchase the said property for a total consideration of", {}),
        ("Rs. 2,85,00,000/- (Rupees Two Crore Eighty Five Lakh only);", {}),
        None,
        ("NOW THIS DEED WITNESSETH AS FOLLOWS:", {"font": "Helvetica-Bold"}),
        None,
        ("1.  The Vendor doth hereby grant, convey and transfer unto the Purchaser", {}),
        ("    the property described in the Schedule, free from all encumbrances.", {}),
        None,
        ("2.  The Purchaser shall pay the balance consideration of Rs. 85,00,000/-", {}),
        ("    within 30 days of execution hereof by RTGS to the Vendor's account", {}),
        ("    A/c No. 512345678901 with Canara Bank, IFSC: CNRB0000512.", {}),
        None,
        ("3.  The Vendor shall deliver vacant physical possession on or before", {}),
        ("    30/09/2024 and shall bear all municipal taxes up to that date.", {}),
        None,
        ("4.  The Purchaser shall bear the stamp duty and registration charges.", {}),
        None,
        ("5.  Any dispute arising out of this deed shall be referred to", {}),
        ("    arbitration by a sole arbitrator under the Arbitration and", {}),
        ("    Conciliation Act, 1996. The courts at Bengaluru alone shall have", {}),
        ("    exclusive jurisdiction.", {}),
        None,
        ("SCHEDULE OF PROPERTY", {"font": "Helvetica-Bold", "centre": True}),
        None,
        ("All that piece and parcel of residential land measuring 2,400 sq. ft.", {}),
        ("bearing Survey No. 128/3, Khata No. 445, situated at Begur Village,", {}),
        ("Bengaluru South Taluk, together with the building thereon bearing", {}),
        ("Municipal No. 78/2, and bounded as follows:", {}),
        ("    East  : Property of Shri Ramesh Gowda", {}),
        ("    West  : 30 feet road", {}),
        ("    North : Survey No. 128/2", {}),
        ("    South : Survey No. 128/4", {}),
        None,
        ("IN WITNESS WHEREOF the parties have set their hands on the day and year", {}),
        ("first above written.", {}),
        None,
        ("VENDOR                                  PURCHASER", {}),
        None,
        ("WITNESSES:", {"font": "Helvetica-Bold"}),
        ("1.  Shri Suresh Babu, S/o Shri Krishnappa, R/o Jayanagar, Bengaluru", {}),
        ("2.  Smt. Radha Bai, W/o Shri Suresh Babu, R/o Jayanagar, Bengaluru", {}),
    ])
    c.save()
    return path


def devanagari_order():
    """Hindi district-court order, to exercise Devanagari OCR routing."""
    if "deva" not in FONTS:
        return None
    path = os.path.join(HERE, "order_hi.text.pdf")
    c = canvas.Canvas(path, pagesize=A4)
    dv = "Ind-deva"
    draw(c, [
        ("जिला एवं सत्र न्यायाधीश, जयपुर के न्यायालय में", {"font": dv, "size": 13, "centre": True}),
        None,
        ("प्रकरण संख्या 456/2024", {"font": dv, "size": 12, "centre": True}),
        None,
        ("राज्य बनाम मोहन लाल", {"font": dv, "size": 12, "centre": True}),
        None,
        ("आदेश", {"font": dv, "size": 12, "centre": True}),
        None,
        ("दिनांक 15/08/2024", {"font": dv, "size": 11}),
        None,
        ("1. अभियुक्त मोहन लाल पुत्र श्री रामलाल, आयु 45 वर्ष, निवासी जयपुर के", {"font": dv, "size": 11}),
        ("   विरुद्ध धारा 302, 307 सहपठित धारा 34 भारतीय दंड संहिता के अंतर्गत", {"font": dv, "size": 11}),
        ("   प्रकरण दर्ज किया गया है।", {"font": dv, "size": 11}),
        None,
        ("2. प्रथम सूचना रिपोर्ट संख्या 0234/2024 पुलिस थाना आदर्श नगर में", {"font": dv, "size": 11}),
        ("   दिनांक 10/03/2024 को दर्ज हुई।", {"font": dv, "size": 11}),
        None,
        ("3. अभियुक्त की जमानत याचिका धारा 439 दंड प्रक्रिया संहिता के अंतर्गत", {"font": dv, "size": 11}),
        ("   प्रस्तुत की गई है। राशि रु. 50,000/- का व्यक्तिगत बंधपत्र।", {"font": dv, "size": 11}),
        None,
        ("4. प्रकरण की अगली सुनवाई दिनांक 20/09/2024 को नियत की जाती है।", {"font": dv, "size": 11}),
        None,
        ("                                        जिला एवं सत्र न्यायाधीश", {"font": dv, "size": 11}),
        ("                                        जयपुर", {"font": dv, "size": 11}),
    ])
    c.save()
    return path


def tamil_order():
    if "taml" not in FONTS:
        return None
    path = os.path.join(HERE, "order_ta.text.pdf")
    c = canvas.Canvas(path, pagesize=A4)
    tm = "Ind-taml"
    draw(c, [
        ("சென்னை உயர் நீதிமன்றம்", {"font": tm, "size": 14, "centre": True}),
        None,
        ("வழக்கு எண் 789/2024", {"font": tm, "size": 12, "centre": True}),
        None,
        ("ராமன் எதிர் தமிழ்நாடு அரசு", {"font": tm, "size": 12, "centre": True}),
        None,
        ("உத்தரவு", {"font": tm, "size": 12, "centre": True}),
        None,
        ("நாள் 15 ஆகஸ்ட் 2024", {"font": tm, "size": 11}),
        None,
        ("மனுதாரர் ராமன், வயது 38, சென்னை வாசி.", {"font": tm, "size": 11}),
        ("பிரிவு 420 இந்திய தண்டனைச் சட்டம்.", {"font": tm, "size": 11}),
        ("தொகை ரூ. 5,00,000/-", {"font": tm, "size": 11}),
    ])
    c.save()
    return path


# ---------------------------------------------------------------------------
def make_scan(pdf_path, angle=0.7, noise=14, blur=0.5, quality=55, dpi=300):
    """
    Turn a text-layer PDF into a realistic scan: rasterise, rotate slightly,
    add sensor noise, blur, then round-trip through low-quality JPEG.

    Why all four degradations: a clean rasterisation is not a test. Real Indian
    court scans arrive skewed by a degree or two off a flatbed, speckled, soft,
    and JPEG-crushed by a photocopier's scan-to-email. Each of these breaks a
    different part of the pipeline — skew breaks line grouping, noise breaks
    character confidence, JPEG ringing breaks thin Devanagari matras.
    """
    base = pdf_path.replace(".text.pdf", "")
    subprocess.run(
        ["pdftoppm", "-r", str(dpi), "-png", pdf_path, base + "-raw"],
        check=True, capture_output=True,
    )
    pages = sorted(p for p in os.listdir(HERE)
                   if p.startswith(os.path.basename(base) + "-raw") and p.endswith(".png"))
    out_imgs = []
    for i, p in enumerate(pages):
        full = os.path.join(HERE, p)
        img = Image.open(full).convert("L")
        img = img.rotate(angle, resample=Image.BICUBIC, fillcolor=255, expand=False)
        px = img.load()
        w, h = img.size
        # Sparse salt-and-pepper, which is what dust on a platen looks like.
        for _ in range((w * h) // 900):
            x, y = random.randrange(w), random.randrange(h)
            px[x, y] = max(0, min(255, px[x, y] + random.randint(-noise * 6, noise * 2)))
        img = img.filter(ImageFilter.GaussianBlur(blur))
        jpg = os.path.join(HERE, f"{os.path.basename(base)}-scan-{i}.jpg")
        img.save(jpg, "JPEG", quality=quality)
        out_imgs.append(jpg)
        os.remove(full)

    scan_pdf = base + ".scan.pdf"
    imgs = [Image.open(p).convert("RGB") for p in out_imgs]
    imgs[0].save(scan_pdf, save_all=True, append_images=imgs[1:], resolution=dpi)
    return scan_pdf, out_imgs


if __name__ == "__main__":
    built = []
    for fn in (fir, judgement, notice_138, bail_petition, sale_deed,
               devanagari_order, tamil_order):
        p = fn()
        if p:
            built.append(p)
            print("built", os.path.basename(p))
    for p in built:
        scan, imgs = make_scan(p)
        print("  scanned ->", os.path.basename(scan), f"({len(imgs)} page image(s))")
