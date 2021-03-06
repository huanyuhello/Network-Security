/* This is the general class for gmail-crypt that runs within gmail context.
 *
 * Copyright 2011 - 2013 Sean Colyer, <sean @ colyer . name>
 * This program is licensed under the GNU General Public License Version 2.
 * See included "LICENSE" file for details.
 */
var sanitizeHtml = require('sanitizeHtml');
// var mvelo = require('mvelo');
// import './mvelo'
var rootElement = $(document);



//This clear and save is specific to the embedded reply composes
function clearAndSaveReply(event){
  rootElement.find('[class*="gA gt"] [g_editable]').html('');
  var replyForm = rootElement.find('[class*="gA gt"] form[method="POST"]');
  replyForm.attr('id', replyForm.attr('old-id'));
  $(event.target).find('a').click();
  return true;
}

function clearAndSave(event){
  //Find the related compose box, and blank out, then proceed as if normal closing.
  //TODO could probably clean this up to be more DRY
  $(event.target).parents('[class="I5"]').find('[g_editable]').html('');
  saveDraft(event);
}

function saveDraft(event){
  var form = $(event.target).parents('[class="I5"]').find('form[method="POST"]');
  form.attr('id', form.attr('old-id'));
  return true;
}

function rebindSendButtons(){
  console.log("ddddddddddd");
  var sendButtons = rootElement.find('td[class="gU Up"] > div > [role="button"]');
  sendButtons.mousedown(saveDraft);

  var closeComposeButtons = rootElement.find('[class="Ha"]');
  closeComposeButtons.mousedown(clearAndSave);

  if (rootElement.find('[class*="gA gt"]')) {
    rootElement.find('.oo').click(clearAndSaveReply);
    rootElement.find('.adf').click(clearAndSaveReply);
  }
}

function getContents(form, event){
  //g_editable is intended to work with Gmail's new broken out window approach.
  //we search based on event because it works well in case multiple compose windows are open
  var msg;
  var g_editable = $(event.currentTarget).parents('.I5').find('[g_editable]').first();
  if (g_editable && g_editable.length > 0 && g_editable.html()) {
    msg = g_editable.html().replace(/(<div>)/g,'\n');
    msg = msg.replace(/(<\/div>)/g,'');
    return {g_editable: g_editable, msg: msg};
  }
  var textarea = $('textarea[spellcheck="true"]',form);
  var iframe = $('iframe',form).contents().find('body');
  try{
    msg = iframe.html().replace(/(<div>)/g,'\n');
    msg = msg.replace(/(<\/div>)/g,'');
  }
  catch(e){
    msg = textarea.val();
  }
  return {textarea: textarea, iframe: iframe, msg: msg };
}

//This could be streamlined as google has change this mechanism frequently.
function writeContents(contents, message){
  if (contents.g_editable) {
    message = message.split('\n').join('<br/>');
    contents.g_editable.html(message);
  }
  try{
    contents.iframe[0].innerText = message;
  }
  catch(e){
    //No iframe (rich editor) entry, only plaintext loaded
  }
  try{
    contents.textarea.val(message);
  }
  catch(e){
    //No plaintext editor
  }
}

function getRecipients(form, event){
  var recipients = {};
  recipients.email = [];
  var emailsParent = $(event.currentTarget).parents('.I5').find('[email]').last().parent().parent();
  if (emailsParent && emailsParent.length > 0) {
    emailsParent.find('[email]').each(function() {
      recipients.email.push($(this).attr("email"));
    });
  }
  return recipients;
}

function findSender(form) {
  // First look at the form (this works for multi-account users)
  var from = form.find('[name="from"]').val();
  // These selectors have been slightly unstable so taking a priority based approach
  var selectors = [ '.gb_ja', '.gb_ia'];
  $.each(selectors, function(selector) {
    if ($.isEmptyObject(from) || from.indexOf('@') < 0) {
      from = $(selector).text();
    }
  });

  // This is a backup in case all of the other means have failed.
  if ($.isEmptyObject(from) || from.indexOf('@') < 0) {
    from = $('.gb_ga').closest(':contains("@")').find(':contains("@")').text();
  }

  return from;
}

// Cheating at multisync
var pendingBackgroundCall = false;
function sendAndHandleBackgroundCall(event){
  if (pendingBackgroundCall) {
    return;
  }
  pendingBackgroundCall = true;
  var form = $(event.currentTarget).parents('.I5').find('form');
  form.find('.alert').hide();
  var contents = getContents(form, event);
  var password = form.find('#gCryptPasswordEncrypt').val();
  var recipients = getRecipients(form, event);
  var from = findSender(form);
  console.log(password)
  $(event.currentTarget).parent().find('[class*=btn]').addClass('disabled');

  sendExtensionRequestPromise({method: event.data.action, recipients: recipients, from: from, message: contents.msg, password: password})
  .then(function(response) {
    if(response.type && response.type == "error") {
      console.log(response)
      showAlert(response, form);
    }
    console.log(password)
    // console.log("recipients:" + recipients);
    // console.log("from:" + from);
    // console.log("form:" + form);
    $(event.currentTarget).parent().find('[class*=btn]').removeClass('disabled');
    pendingBackgroundCall = false;
    console.log(response);
    writeContents(contents, response);
  });
}

function getMessage(objectContext){
  var msg;
  //we need to use regex here because gmail will automatically form \n into <br> or <wbr>, strip these out
  //I'm not entirely happy with these replace statements, perhaps there can be a different approach
  var element = $(event.currentTarget).closest('div[class="gs"]').find('[class*="ii gt"] div');
  msg = element.html().replace(/\n/g,"");
  msg = msg.replace(/(<br><\/div>)/g,'\n'); //we need to ensure that extra spaces aren't added where gmail puts a <div><br></div>
  msg = msg.replace(/(<\/div>)/g,'\n');
  msg = msg.replace(/(<br.*?>)/g,'\n');

  //originally stripped just <br> and <wbr> but gmail can add other things such as <div class="im">
  msg = msg.replace(/<(.*?)>/g,'');
  return [element, msg];
}

function sendAndHandleDecryptAndVerify(event){
  rootElement.find('.alert').hide();
  var password = $(this).parent().parent().find('form[class="form-inline"] input[type="password"]').val();
  var objectContext = this;
  var setup = getMessage(objectContext);
  var element = setup[0];
  var msg = setup[1];
  var senderEmail = $(objectContext).parents('div[class="gE iv gt"]').find('span [email]').attr('email');
  console.log(password);
  chrome.extension.sendRequest({method: event.data.action, senderEmail:senderEmail, msg: msg, password: password}, function(response){
    $.each(response.status, function(key, status) {
      $(objectContext).parents('div[class="gE iv gt"]').append(status.html);
    });
    if (response.decrypted) {
      var text;
      if (response.result.text) {
        text = response.result.text;
      }
      else {
        // We have to do this because sometimes the API returns just the text
        text = response.result;
      }
      // TODO let's add a warning if the sanitizeHtml has a significant impact on the text length/content
      text = sanitizeHtml(text.replace(/\n/g,'<br>'));
      element.html(text);
    }
  });
}

function stopAutomaticDrafts(){
  //Find all open compose windows, then set them not to save
  var forms = rootElement.find('.I5 form[method="POST"]');//rootElement.find('[class="nH Hd"] form[method="POST"]');
  $.each(forms, function(key, value) {
    //We change the ID of the form so that gmail won't upload drafts. Store old in "old-id" attribute for restoration.
    var form = $(value);
    var formId = form.attr('id');
    if (formId != 'gCryptForm') {
      form.attr('old-id', formId);
      form.attr('id','gCryptForm');
    }
  });

  rebindSendButtons();
  //setTimeout here because we need to check if new windows are opened
  setTimeout(stopAutomaticDrafts, 2000);
}

function showAlert(alert, form) {
  if(form) {
    var alertInForm = form.find('#'+alert.id);
    if (alertInForm && alertInForm.length > 0) {
      alertInForm.show();
      return;
    }
  }
  showModalAlert(alert.html);
}

function showModalAlert(message) {
  $('#gCryptModalBody').html(message);
  $('#gCryptModal').modal('show');
}

function sendExtensionRequestPromise(request) {
  // console.log("first");
  // console.log("request:" + request);
  // console.log(request.bodydata)
  var deferred = $.Deferred();
  chrome.extension.sendRequest(request, function(response){
    // console.log("response:" + response);
    deferred.resolve(response);
  });
  return deferred.promise();
}


// function dataURL2str(dataURL) {
//   var base64 = dataURL.split(';base64,')[1];
//   return mvelo.util.getDOMWindow().atob(base64);
// }

function encryptfile(event){
  console.log('test');
  if (pendingBackgroundCall) {
    return;
  }
  // var submitattach = document.getElementsByClassName("a1 aaA aMZ")[0];

  pendingBackgroundCall = true;
  var file = document.getElementById('filesToUpload').files[0];
  var filename = file.name;
  var form = $(event.currentTarget).parents('.I5').find('form');
  // var submitattach = $(event.currentTarget).parents('aDh').find('command="Files"');
  // console.log(submitattach);
  form.find('.alert').hide();

  var password = form.find('#gCryptPasswordEncrypt').val();
  var recipients = getRecipients(form, event);
  var from = findSender(form);
  $(event.currentTarget).parent().find('[class*=btn]').addClass('disabled');
  var reader = new FileReader();
  reader.onload = function(e) {
    var msg = e.target.result;
    // var content = dataURL2str(msg);
    // console.log("content:" + content);
    sendExtensionRequestPromise({method: event.data.action, recipients: recipients, from: from, message: msg, password: password})
    .then(function(response) {
      if(response.type && response.type == "error") {
        showAlert(response, form);
      }
      else {

        $(event.currentTarget).parent().find('[class*=btn]').removeClass('disabled');
        pendingBackgroundCall = false;
        // var file1 = new File([msg], "filename");
        //
        // saveAs(file1);
        var file2 = new File([response], filename);
        // submitattach.add(file2);
        // submitattach.submit(file2);
        saveAs(file2);
      }
    });
    // console.log("msg:" + msg);
  }
  reader.readAsBinaryString(file);
  // reader.readAsDataURL(file);
}

function decryptfile(event){
  console.log('decryptfile');
  if (pendingBackgroundCall) {
    return;
  }
  rootElement.find('.alert').hide();
  pendingBackgroundCall = true;
  var file = document.getElementById('uploadfile').files[0];
  var filename = file.name;
  console.log(filename);

  var password = $(this).parent().parent().find('form[class="form-inline"] input[type="password"]').val();
  var objectContext = this;
  var setup = getMessage(objectContext);
  console.log(password);
  var senderEmail = $(objectContext).parents('div[class="gE iv gt"]').find('span [email]').attr('email');
  var reader = new FileReader();
  reader.onload = function(e) {
    var msg = e.target.result;
    // console.log("msg:" + msg);

    chrome.extension.sendRequest({method: event.data.action, senderEmail:senderEmail, msg: msg, password: password}, function(response){
      $.each(response.status, function(key, status) {
        $(objectContext).parents('div[class="gE iv gt"]').append(status.html);
      });
      if (response.decrypted) {
        var text;
        if (response.result.text) {
          text = response.result.text;

          var file1 = new File([text], filename);
          saveAs(file1);
        }
        else {
      // We have to do this because sometimes the API returns just the text
          text = response.result;
          var file1 = new File([text], "filename11");
          saveAs(file1);
        }
      }
    });
  }
  reader.readAsBinaryString(file);
  // reader.readAsDataURL(file);
}


//Equivalences (255 random values you can use a personalized version)

function encryptimg(){

    var r,g,b,data,imgData,length,i
    var image = document.getElementById('imgToUpload').files[0];
    if (!image.type.match('image.*')) {
      console.log("not match");
      return;
    }
    var reader = new FileReader();

    reader.onload = (function(image) {
       // Render thumbnail.
        console.log("11111");
        console.log(image)
        // downloadCanvas(this, image, "file.jpg");
        exampleImage(image.target.result,true);

    });
    reader.readAsDataURL(image);
}

reference = [86,112,145,159,208,239,140,217,44,15,203,229,40,213,6,154,103,16,37,53,198,243,43,33,171,235,233,24,148,23,70,179,35,193,75,207,162,65,150,137,45,5,32,216,108,224,250,219,170,62,9,163,220,117,228,132,161,241,202,157,169,189,115,114,27,109,99,106,71,85,47,143,83,215,133,104,255,197,89,60,17,87,69,84,254,52,244,11,158,141,166,30,125,21,126,172,247,191,102,181,67,165,46,246,8,66,113,205,200,29,48,39,186,231,230,242,111,129,105,249,192,94,134,120,160,90,199,34,110,187,142,0,237,218,174,178,195,97,3,180,190,119,91,96,245,175,167,135,14,253,72,155,116,55,10,13,222,63,68,121,182,127,183,88,214,2,50,168,36,64,177,201,151,107,152,206,240,78,59,149,18,92,138,28,76,51,146,77,188,12,124,210,31,128,211,209,225,212,164,58,82,223,93,131,144,79,38,80,7,25,173,101,234,122,19,226,118,194,42,156,176,252,22,73,184,49,204,4,251,185,232,248,1,196,221,227,20,98,61,153,130,26,57,41,147,238,95,139,74,123,236,56,136,54,81,100];


function exampleImage(src,type){
  // console.log("src:" + src);
  var myImg = new Image();

  myImg.onload = function(){
    var canvas = document.createElement('canvas');
    var context = canvas.getContext('2d');
    context.clearRect(0,0,canvas.width,canvas.height)
    canvas.width = myImg.width;
    canvas.height = myImg.height;
    context.drawImage(myImg,0,0)
    setup();
    var ImageData = context.getImageData(0,0,canvas.width,canvas.height);
    var data = ImageData.data;
    var length = data.length;
    var i;
    // data = 0;
    if(type){
      for (i =0; i <length*.5; i+=4)
      {
        if(i%8==0){
          r=reference[data[i]]
          g=reference[data[i+1]]
          b=reference[data[i+2]]
          data[i]=reference[data[length-i]]
          data[i+1]=reference[data[length-i+1]]
          data[i+2]=reference[data[length-i+2]]
          data[length-i]=r
          data[length-i+1]=g
          data[length-i+2]=b
        }else{
          data[i]=reference[data[i]]
          data[i+1]=reference[data[i+1]]
          data[i+2]=reference[data[i+2]]
          data[length-i]=reference[data[length-i]]
          data[length-i+1]=reference[data[length-i+1]]
          data[length-i+2]=reference[data[length-i+2]]
        }
      }
    }
    else {
      for(i=0;i<length*.5;i+=4){
        if(i%8==0){
          r=referenceReverse[data[i]]
          g=referenceReverse[data[i+1]]
          b=referenceReverse[data[i+2]]
          data[i]=referenceReverse[data[length-i]]
          data[i+1]=referenceReverse[data[length-i+1]]
          data[i+2]=referenceReverse[data[length-i+2]]
          data[length-i]=r
          data[length-i+1]=g
          data[length-i+2]=b
        }else{
          data[i]=referenceReverse[data[i]]
          data[i+1]=referenceReverse[data[i+1]]
          data[i+2]=referenceReverse[data[i+2]]
          data[length-i]=referenceReverse[data[length-i]]
          data[length-i+1]=referenceReverse[data[length-i+1]]
          data[length-i+2]=referenceReverse[data[length-i+2]]
        }
      }
    }

    context.putImageData(ImageData,0,0);

    var dataimage = canvas.toDataURL("image/png");//.replace("image/jpg", "image/octet-stream");
    // document.write('<img src="'+dataimage+'"/>');
    // console.log("test");
    window.location.href = dataimage;
  }
  myImg.src = src;
}

function decryptimg(){

  var r,g,b,data,imgData,length,i
  var image = document.getElementById('Imgtodecrypt').files[0];
  if (!image.type.match('image.*')) {
    console.log("not match");
    return;
  }
  var reader = new FileReader();

  reader.onload = (function(image) {
     // Render thumbnail.
      console.log("11111");
      console.log(image)
      // downloadCanvas(this, image, "file.jpg");
      exampleImage(image.target.result,false);

  });
  reader.readAsDataURL(image);
}

function downloadCanvas(image,filename) {

}
//This function is for configure the decryption
function setup(){
  console.log("setup")
  referenceReverse = []
  for(var i=0;i<reference.length;i++){
    referenceReverse[reference[i]]=i
  }
  reference = new Uint8Array(reference)
  referenceReverse = new Uint8Array(referenceReverse)
}

function composeIntercept(ev) {
  var composeBoxes = $('.n1tfz');
  if (composeBoxes && composeBoxes.length > 0) {
    composeBoxes.each(function(){
      var composeMenu = $(this).parent().parent().parent();
      if (composeMenu && composeMenu.length> 0 && composeMenu.find('#gCryptEncrypt').length === 0) {
        var maxSizeCheck = composeMenu.parent().parent().parent().parent().parent().find('[style*="max-height"]');
        //The below logic is for inserting the form into the windows, different behavior for in window compose and popout compose.
        var encryptionFormOptions = '<span id="gCryptEncrypt" class="btn-group" style="float:right"><a class="btn btn-primary button-container" href="#" id="encryptAndSign">Encrypt and Sign</a><a class="btn btn-primary button-container" href="#" id="encrypt">Encrypt</a><a class="btn btn-primary button-container" href="#" id="upload">File</a><a class="btn btn-primary button-container" href="#" id="images">Image</a><input class="input-container" name="filesToUpload" id="filesToUpload" type="file" multiple="" /><label for="filesToUpload" class="btn btn-primary button-container">Choose File</label><input class="input-container" name="imgToUpload" id="imgToUpload" type="file" multiple="" /><label for="imgToUpload" class="btn btn-primary button-container">Choose Image</label><canvas id="canvas"></canvas></span>';

        var encryptionForm = '<form class="form-inline form-container-2" style="float:right"><input type="password" class="input-small password-container-2" placeholder="" id="gCryptPasswordEncrypt" style="font-size:12px;margin-top:5px;"></form>';

        if (maxSizeCheck && maxSizeCheck.length > 0 && maxSizeCheck.css('max-height') === maxSizeCheck.css('height')) {
          composeMenu.find('.n1tfz :nth-child(6)').after('<td class="gU" style="min-width: 360px;">' + encryptionFormOptions + '</td><td class="gU">' + encryptionForm + '</td>');
        }
        else {
          composeMenu.append(encryptionFormOptions + encryptionForm);
          composeMenu.css("height","80px");
        }
        composeMenu.find('#encryptAndSign').click({action: "encryptAndSign"}, sendAndHandleBackgroundCall);
        composeMenu.find('#encrypt').click({action: "encrypt"}, sendAndHandleBackgroundCall);
        composeMenu.find('#sign').click({action: "sign"}, sendAndHandleBackgroundCall);
        composeMenu.find('#upload').click({action: "upload"}, encryptfile);
        composeMenu.find('#images').click({action: "image"}, encryptimg);
        composeMenu.find('form[class="form-inline"]').submit({action: "encryptAndSign"}, function(event){
          sendAndHandleBackgroundCall(event);
          return false;
        });
      }
    });
    sendExtensionRequestPromise({method: 'getOption', option: 'stopAutomaticDrafts', thirdParty: true})
    .then(function(response) {
      if(response === true){
        stopAutomaticDrafts();
      }
    });
  }

  var viewTitleBar = rootElement.find('td[class="gH acX"]');
  if (viewTitleBar && viewTitleBar.length > 0) {
    viewTitleBar.each(function(v) {
      if ($(this).find('#gCryptDecrypt').length === 0) {
        $(this).prepend('<span id="gCryptDecrypt"><a class="btn btn-primary button-container" action="decrypt" id="decrypt">Decrypt</a></span>');
        $(this).find('#decrypt').click({action: "decrypt"}, sendAndHandleDecryptAndVerify);
        $(this).append('<form class="form-inline"><input type="password" class="input-small password-container" placeholder="password" id="gCryptPasswordDecrypt"></form>');
        $(this).find('form[class="form-inline"]').submit(function(event){
          $(this).parent().find('a[action="decrypt"]').click();
          return false;
        });
        $(this).prepend('<span id="gCryptVerify"><a class="btn btn-primary button-container" id="verify">Verify Signature</a><a class="btn btn-primary button-container" href="#" id="decryptfile">DecryptFile</a><a class="btn btn-primary button-container" href="#" id="image">DecryptImg</a><input class="input-container" name="Uploadfile" id="uploadfile" type="file" multiple="" /><label for="uploadfile" class="btn btn-primary button-container">Choose File</label><input class="input-container" name="Imgtodecrypt" id="Imgtodecrypt" type="file" multiple="" /><label for="Imgtodecrypt" class="btn btn-primary button-container">Choose Image</label></span>');
        $(this).find('#verify').click({action: "verify"}, sendAndHandleDecryptAndVerify);
        $(this).find('#decryptfile').click({action: "decryptfile"}, decryptfile);
        $(this).find('#image').click({action: "decryptimg"}, decryptimg);
      }
    });
  }

  var gmailCryptModal = $('#gCryptModal');
  if(gmailCryptModal && gmailCryptModal.length === 0) {
    $('.aAU').append('<div id="gCryptModal" class="modal hide fade" tabindex=-1 role="dialog"><div class="modal-header">' +
                     '<button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>' +
                     '<h3>Mymail-Crypt for Gmail</h3></div><div id="gCryptModalBody" class="modal-body"></div></div>');
    $('#gCryptModal').click(function() {
      $('#gCryptModal').modal('hide');
    });
  }
}

//This animation strategy inspired by http://blog.streak.com/2012/11/how-to-detect-dom-changes-in-css.html
//based on http://davidwalsh.name/detect-node-insertion changes will depend on CSS as well.
var insertListener = function(event) {
  if (event.animationName == "composeInserted") {
    composeIntercept();
  }
};

// TODO this used to be more reliable to call the eventlistener in $(document).ready idk why it's not now
//$(document).ready(onLoadAnimation);
document.addEventListener("webkitAnimationStart", insertListener, false);
